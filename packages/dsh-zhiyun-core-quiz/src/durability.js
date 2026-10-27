export function storageCode(error) {
  for(let e=error,i=0;e&&i<6;e=e.cause??e.details?.cause,i++)if(['EACCES','EPERM','EBUSY','ENOSPC','EIO'].includes(e.code))return e.code;
  return error?.code??null;
}
/** Only retry known transient file contention, with the identical idempotent snapshot. */
export async function persistWithRetry(write) {
  for(let attempt=0;;attempt++)try{return await write();}catch(error){
    if(attempt>=3||!['EACCES','EPERM','EBUSY'].includes(storageCode(error)))throw error;
    await new Promise(resolve=>setTimeout(resolve,25*2**attempt));
  }
}
