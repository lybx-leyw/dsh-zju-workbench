// Read-only WeChat task access. Database keys travel only over anonymous pipes.
// SQLCipher layout and page authentication follow runtime-key.cs in this project.
#include <CommonCrypto/CommonHMAC.h>
#include <CommonCrypto/CommonKeyDerivation.h>
#include <CommonCrypto/CommonCryptor.h>
#include <CommonCrypto/CommonDigest.h>
#include <libproc.h>
#include <mach/mach.h>
#include <mach/mach_vm.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define PAGE 4096
#define MAX_DATABASES 128
#define CHUNK (1024 * 1024)
#define BYTE_LIMIT (1536ULL * 1024 * 1024)

typedef struct {
    unsigned char page[PAGE], key[32];
    int found;
} Target;

typedef struct {
    mach_vm_address_t address;
    mach_vm_size_t size;
} Region;

static Target targets[MAX_DATABASES];
static unsigned int target_count;
static task_t task;
static unsigned long long bytes_read;
static double deadline;
static unsigned char *image_prefix;
static unsigned int image_plain_size, image_encrypted_size;
static unsigned char image_key[16];
static char image_account[129];
static int image_mode, image_found;
#ifdef WEREAD_DIAGNOSTICS
static unsigned int codec_hits, salt_hits, spec_hits;
#endif

static void wipe(void *buffer, size_t length) {
    volatile unsigned char *bytes = buffer;
    while (length--) *bytes++ = 0;
}

static double now(void) {
    struct timespec value;
    clock_gettime(CLOCK_MONOTONIC, &value);
    return value.tv_sec + value.tv_nsec / 1e9;
}

static int fail(const char *code) {
    fprintf(stderr, "{\"error\":\"%s\"}\n", code);
    wipe(targets, sizeof(targets));
    wipe(image_key, sizeof(image_key));
    if (image_prefix) { wipe(image_prefix, image_encrypted_size); free(image_prefix); }
    if (task != MACH_PORT_NULL) mach_port_deallocate(mach_task_self(), task);
    return 1;
}

static int complete(void) {
    if (image_mode) return image_found;
    for (unsigned int i = 0; i < target_count; i++)
        if (!targets[i].found) return 0;
    return 1;
}

static int equal(const unsigned char *a, const unsigned char *b, size_t size) {
    unsigned char diff = 0;
    for (size_t i = 0; i < size; i++) diff |= a[i] ^ b[i];
    return diff == 0;
}

static int verify(Target *target, const unsigned char key[32]) {
    unsigned char salt[16], mac_key[32], digest[64], message[4020];
    for (int i = 0; i < 16; i++) salt[i] = target->page[i] ^ 0x3a;
    if (CCKeyDerivationPBKDF(kCCPBKDF2, (const char *)key, 32, salt, 16,
                            kCCPRFHmacAlgSHA512, 2, mac_key, 32) != kCCSuccess)
        return 0;
    memcpy(message, target->page + 16, 4016);
    memset(message + 4016, 0, 4);
    message[4016] = 1;
    CCHmac(kCCHmacAlgSHA512, mac_key, 32, message, sizeof(message), digest);
    int valid = equal(digest, target->page + 4032, 64);
    wipe(mac_key, sizeof(mac_key));
    wipe(digest, sizeof(digest));
    wipe(message, sizeof(message));
    if (valid) {
        memcpy(target->key, key, 32);
        target->found = 1;
    }
    return valid;
}

static int unhex(const unsigned char *text, size_t length, unsigned char *out) {
    for (size_t i = 0; i < length; i++) {
        unsigned char c = text[i];
        int n = c >= '0' && c <= '9' ? c - '0' :
                c >= 'a' && c <= 'f' ? c - 'a' + 10 :
                c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
        if (n < 0) return 0;
        if (i % 2 == 0) out[i / 2] = (unsigned char)(n << 4);
        else out[i / 2] |= n;
    }
    return 1;
}

static int read_at(mach_vm_address_t address, void *buffer, size_t size) {
    mach_vm_size_t actual = 0;
    if (address < 0x10000 || address > 0x0000ffffffffffffULL) return 0;
    return mach_vm_read_overwrite(task, address, size,
                                  (mach_vm_address_t)buffer, &actual) == KERN_SUCCESS
           && actual == size;
}

static uint64_t pointer_at(const unsigned char *bytes, size_t offset) {
    uint64_t value;
    memcpy(&value, bytes + offset, sizeof(value));
    return value;
}

static void key_spec(Target *target, const unsigned char *blob) {
    unsigned char decoded[99], mask[32], key[32], salt_hex[32];
    // Some WCDB versions keep the raw SQLCipher key spec behind a repeating XOR
    // mask. Its known database salt determines that mask; HMAC authenticates it.
    for (int upper = 0; upper < 2 && !target->found; upper++) {
        const char *digits = upper ? "0123456789ABCDEF" : "0123456789abcdef";
        for (int j = 0; j < 16; j++) {
            salt_hex[j * 2] = digits[target->page[j] >> 4];
            salt_hex[j * 2 + 1] = digits[target->page[j] & 15];
        }
        for (int j = 66; j < 98; j++) mask[j % 32] = blob[j] ^ salt_hex[j - 66];
        for (int j = 0; j < 99; j++) decoded[j] = blob[j] ^ mask[j % 32];
        if (decoded[0] == 'x' && decoded[1] == '\'' && decoded[98] == '\''
            && unhex(decoded + 2, 64, key)) verify(target, key);
    }
    wipe(decoded, sizeof(decoded));
    wipe(mask, sizeof(mask));
    wipe(key, sizeof(key));
}

static void codec(mach_vm_address_t address) {
#ifdef WEREAD_DIAGNOSTICS
    codec_hits++;
#endif
    unsigned char ctx[160], salt[16], cipher[80], key[32], blob[99];
    if (!read_at(address, ctx, sizeof(ctx))) return;
    for (int salt_offset = 56; salt_offset <= 80; salt_offset += 8) {
        if (!read_at(pointer_at(ctx, salt_offset), salt, sizeof(salt))) continue;
        for (unsigned int i = 0; i < target_count; i++) {
            Target *target = &targets[i];
            if (target->found || !equal(salt, target->page, 16)) continue;
#ifdef WEREAD_DIAGNOSTICS
            salt_hits++;
#endif
            for (int p = salt_offset + 24; p <= salt_offset + 48; p += 8) {
                if (!read_at(pointer_at(ctx, p), cipher, sizeof(cipher))) continue;
                for (int k = 8; k <= 64 && !target->found; k += 8) {
                    if (read_at(pointer_at(cipher, k), key, sizeof(key)))
                        verify(target, key);
                }
                if (!target->found && read_at(pointer_at(cipher, 32), blob, sizeof(blob)))
                    key_spec(target, blob);
            }
        }
    }
    wipe(ctx, sizeof(ctx));
    wipe(cipher, sizeof(cipher));
    wipe(key, sizeof(key));
    wipe(blob, sizeof(blob));
}

static void inspect(const unsigned char *buffer, size_t size, mach_vm_address_t base) {
    const uint32_t signature[] = {256000, 2, 16, 32, 16, 16, 4096};
    unsigned char key[32], salt[16];
    // First try literal raw-key specs. These are a SQLCipher convention, not a
    // fixed app-version offset. Only keys authenticated against requested DBs win.
    for (size_t i = 0; i + 67 <= size; i++) {
        if (buffer[i] != 'x' || buffer[i + 1] != '\'') continue;
        if (!unhex(buffer + i + 2, 64, key)) continue;
#ifdef WEREAD_DIAGNOSTICS
        spec_hits++;
#endif
        if (i + 99 <= size && buffer[i + 98] == '\''
            && unhex(buffer + i + 66, 32, salt)) {
            for (unsigned int j = 0; j < target_count; j++)
                if (!targets[j].found && equal(salt, targets[j].page, 16))
                    verify(&targets[j], key);
        } else if (buffer[i + 66] == '\'') {
            for (unsigned int j = 0; j < target_count; j++)
                if (!targets[j].found) verify(&targets[j], key);
        }
    }
    size_t offset = 0;
    while (offset + sizeof(signature) <= size) {
        const unsigned char *hit = memmem(buffer + offset, size - offset, signature, sizeof(signature));
        if (!hit) break;
        size_t index = (size_t)(hit - buffer);
        if (base + index >= 4) codec(base + index - 4);
        offset = index + sizeof(signature);
    }
    for (unsigned int j = 0; j < target_count; j++) {
        if (targets[j].found) continue;
        offset = 0;
        while (offset + 16 <= size && !targets[j].found) {
            const unsigned char *hit = memmem(buffer + offset, size - offset, targets[j].page, 16);
            if (!hit) break;
            long index = hit - buffer;
            const int nearby[] = {-32, -40, -48, 16, 24, 32};
            for (size_t k = 0; k < sizeof(nearby) / sizeof(nearby[0]); k++) {
                long position = index + nearby[k];
                if (position >= 0 && (size_t)position + 32 <= size)
                    verify(&targets[j], buffer + position);
                if (targets[j].found) break;
            }
            offset = (size_t)index + 16;
        }
    }
    wipe(key, sizeof(key));
}

static int smaller_region(const void *left, const void *right) {
    const Region *a = left, *b = right;
    return (a->size > b->size) - (a->size < b->size);
}

static int image_format(const unsigned char *data) {
    return !memcmp(data, "\xff\xd8\xff", 3) || !memcmp(data, "\x89PNG\r\n\x1a\n", 8)
        || !memcmp(data, "GIF8", 4) || !memcmp(data, "wxgf", 4)
        || (!memcmp(data, "RIFF", 4) && !memcmp(data + 8, "WEBP", 4));
}

static int verify_image(const unsigned char *key) {
    unsigned char header[16];
    size_t length = 0;
    if (CCCrypt(kCCDecrypt, kCCAlgorithmAES, kCCOptionECBMode, key, 16, NULL,
                image_prefix, 16, header, sizeof(header), &length) != kCCSuccess
        || length != 16 || !image_format(header)) return 0;
    unsigned char *decoded = malloc(image_encrypted_size);
    if (!decoded) return 0;
    int valid = CCCrypt(kCCDecrypt, kCCAlgorithmAES, kCCOptionECBMode | kCCOptionPKCS7Padding,
                       key, 16, NULL, image_prefix, image_encrypted_size,
                       decoded, image_encrypted_size, &length) == kCCSuccess
                && length == image_plain_size;
    wipe(decoded, image_encrypted_size);
    free(decoded);
    if (valid) { memcpy(image_key, key, 16); image_found = 1; }
    return valid;
}

static int alpha(unsigned char c) {
    return (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
}

static void inspect_image(const unsigned char *buffer, size_t size) {
    unsigned char key[16], digest[CC_MD5_DIGEST_LENGTH];
    char seed_text[12], material[144];
    for (size_t i = 0; i < size && !image_found;) {
        if (!alpha(buffer[i])) { i++; continue; }
        size_t start = i;
        while (i < size && alpha(buffer[i])) i++;
        size_t length = i - start;
        if (length == 16 || length == 32) {
            verify_image(buffer + start);
        } else if (length >= 5 && length <= 10 && image_account[0]) {
            uint64_t seed = 0;
            int numeric = 1;
            for (size_t j = start; j < i; j++) {
                if (buffer[j] < '0' || buffer[j] > '9') { numeric = 0; break; }
                seed = seed * 10 + buffer[j] - '0';
            }
            if (!numeric || seed > UINT32_MAX) continue;
            snprintf(seed_text, sizeof(seed_text), "%u", (unsigned int)seed);
            snprintf(material, sizeof(material), "%s%s", seed_text, image_account);
            // MD5 is dictated by WeChat's cache format, not chosen for security.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
            CC_MD5(material, (CC_LONG)strlen(material), digest);
#pragma clang diagnostic pop
            const char *digits = "0123456789abcdef";
            for (int j = 0; j < 8; j++) {
                key[j * 2] = digits[digest[j] >> 4];
                key[j * 2 + 1] = digits[digest[j] & 15];
            }
            verify_image(key);
        }
    }
    wipe(key, sizeof(key));
    wipe(digest, sizeof(digest));
    wipe(material, sizeof(material));
}

int main(int argc, char **argv) {
    task = MACH_PORT_NULL;
    if (argc != 2 || isatty(STDIN_FILENO) || isatty(STDOUT_FILENO))
        return fail("invalid_input");
    char *end = NULL;
    long number = strtol(argv[1], &end, 10);
    if (!end || *end || number <= 0 || number > INT32_MAX) return fail("invalid_input");
    pid_t pid = (pid_t)number;
    char executable[PROC_PIDPATHINFO_MAXSIZE] = {0};
    struct proc_bsdinfo info = {0};
    const char *suffix = "/WeChat.app/Contents/MacOS/WeChat";
    if (proc_pidpath(pid, executable, sizeof(executable)) <= 0
        || strlen(executable) < strlen(suffix)
        || strcmp(executable + strlen(executable) - strlen(suffix), suffix)
        || proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != sizeof(info)
        || info.pbi_uid != getuid()) return fail("wechat_not_running");
    unsigned char magic[4];
    if (fread(magic, 1, 4, stdin) != 4) return fail("invalid_input");
    if (!memcmp(magic, "WRK1", 4)) {
        if (fread(&target_count, 4, 1, stdin) != 1
            || !target_count || target_count > MAX_DATABASES) return fail("invalid_input");
        for (unsigned int i = 0; i < target_count; i++)
            if (fread(targets[i].page, 1, PAGE, stdin) != PAGE) return fail("invalid_input");
    } else if (!memcmp(magic, "WRI1", 4)) {
        unsigned int account_size;
        image_mode = 1;
        if (fread(&image_plain_size, 4, 1, stdin) != 1
            || fread(&image_encrypted_size, 4, 1, stdin) != 1
            || fread(&account_size, 4, 1, stdin) != 1
            || image_plain_size < 16 || image_plain_size > CHUNK
            || image_encrypted_size != (image_plain_size / 16 + 1) * 16
            || account_size > 128) return fail("invalid_input");
        image_prefix = malloc(image_encrypted_size);
        if (!image_prefix || fread(image_prefix, 1, image_encrypted_size, stdin) != image_encrypted_size
            || fread(image_account, 1, account_size, stdin) != account_size) return fail("invalid_input");
    } else return fail("invalid_input");
    if (task_for_pid(mach_task_self(), pid, &task) != KERN_SUCCESS)
        return fail("wechat_memory_denied");

    unsigned char *buffer = malloc(CHUNK);
    if (!buffer) return fail("runtime_missing");
    deadline = now() + 75;
    mach_vm_address_t address = 0;
    size_t region_count = 0, capacity = 0;
    Region *regions = NULL;
    while (now() < deadline) {
        mach_vm_size_t size = 0;
        vm_region_extended_info_data_t region;
        mach_msg_type_number_t count = VM_REGION_EXTENDED_INFO_COUNT;
        mach_port_t object = MACH_PORT_NULL;
        kern_return_t status = mach_vm_region(task, &address, &size, VM_REGION_EXTENDED_INFO,
                                               (vm_region_info_t)&region, &count, &object);
        if (object != MACH_PORT_NULL) mach_port_deallocate(mach_task_self(), object);
        if (status != KERN_SUCCESS || !size || address + size <= address) break;
        if ((region.protection & (VM_PROT_READ | VM_PROT_WRITE)) == (VM_PROT_READ | VM_PROT_WRITE)
            && !region.external_pager && (region.pages_resident || region.pages_swapped_out)) {
            if (region_count == capacity) {
                if (capacity >= 65536) break;
                size_t next = capacity ? capacity * 2 : 256;
                Region *expanded = realloc(regions, next * sizeof(Region));
                if (!expanded) break;
                regions = expanded;
                capacity = next;
            }
            regions[region_count++] = (Region){address, size};
        }
        address += size;
    }
    // Small active allocations contain codec contexts; large reserved arenas can
    // otherwise exhaust the scan budget before the relevant heap is reached.
    qsort(regions, region_count, sizeof(Region), smaller_region);
    for (size_t i = 0; i < region_count && !complete()
         && bytes_read < BYTE_LIMIT && now() < deadline; i++) {
        address = regions[i].address;
        mach_vm_size_t size = regions[i].size;
        for (mach_vm_size_t offset = 0; offset < size && !complete()
             && bytes_read < BYTE_LIMIT && now() < deadline;) {
            size_t wanted = size - offset < CHUNK ? (size_t)(size - offset) : CHUNK;
            mach_vm_size_t actual = 0;
            if (mach_vm_read_overwrite(task, address + offset, wanted,
                                      (mach_vm_address_t)buffer, &actual) == KERN_SUCCESS) {
                bytes_read += actual;
                if (image_mode) inspect_image(buffer, (size_t)actual);
                else inspect(buffer, (size_t)actual, address + offset);
            }
            if (wanted <= 256) break;
            offset += wanted - 256;
        }
    }
    free(regions);
    wipe(buffer, CHUNK);
    free(buffer);
#ifdef WEREAD_DIAGNOSTICS
    unsigned int found = 0;
    for (unsigned int i = 0; i < target_count; i++) found += targets[i].found;
    fprintf(stderr, "{\"bytes_read\":%llu,\"codec_hits\":%u,\"salt_hits\":%u,\"spec_hits\":%u,\"found\":%u}\n",
            bytes_read, codec_hits, salt_hits, spec_hits, found);
#endif
    if (!complete()) return fail(image_mode ? "image_key_unavailable" : "wechat_key_unavailable");
    if (image_mode) {
        int written = fwrite("WRI1", 1, 4, stdout) == 4 && fwrite(image_key, 1, 16, stdout) == 16;
        wipe(image_key, sizeof(image_key));
        wipe(image_prefix, image_encrypted_size);
        free(image_prefix);
        mach_port_deallocate(mach_task_self(), task);
        return written && fflush(stdout) == 0 ? 0 : 1;
    }
    int written = fwrite("WRK1", 1, 4, stdout) == 4 && fwrite(&target_count, 4, 1, stdout) == 1;
    for (unsigned int i = 0; i < target_count && written; i++)
        written = fwrite(targets[i].key, 1, 32, stdout) == 32;
    wipe(targets, sizeof(targets));
    mach_port_deallocate(mach_task_self(), task);
    return written && fflush(stdout) == 0 ? 0 : 1;
}
