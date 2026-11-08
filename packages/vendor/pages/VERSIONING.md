# Versioning and release

`dsh-pages` is released from this standalone repository. Its package version follows semantic versioning; release tags use `dsh-pages-v<version>`.

## Prepare without publishing

1. Update package metadata, the English README, and the Chinese README before building. The npm page displays the README included in the published package.
2. Choose a version that has not already been published. npm versions cannot be overwritten.
3. Run:

   ```sh
   npm test
   npm run build
   npm pack --dry-run
   ```

4. Confirm the payload contains the built client, current source, bundle patch, documentation, screenshot, and license. Exclude credentials, local paths, temporary files, dependencies, and test artifacts.
5. Confirm the README's GitHub links point to an existing branch or release. Update them if the repository's release branch changes.

`prepublishOnly` runs tests and builds before `npm publish`. It does not run during `npm pack`, so packing alone does not prove that the client is current. A dry run does not publish anything.

## Publishing is a separate action

Only with explicit approval, sign in to npm, verify package-name ownership, and publish publicly. After publishing, verify the registry version and test installation in a clean DSH profile. Do not use a second installation alongside an existing shell instance.

Later README changes intended for the npm page require another package version. A major release is required for incompatible public config or export changes; internal renames alone are not breaking changes. Publishing npm does not push Git commits or tags to GitHub; those are separate approved actions.

## Compatibility claims

The shell does not mutate native root registrations. Compatibility still depends on host overlay/child-slot support, CSS geometry, and browser behavior. Record release-specific verification rather than carrying forward historical adapter host lists or test counts.

Architecture and lifecycle boundaries are documented in [DESIGN](<DESIGN.md>).
