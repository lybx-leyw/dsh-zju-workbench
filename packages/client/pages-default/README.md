# @lybx-leyw/dsh-zju-pages-default

把 `@lybx-leyw/dsh-pages` 的导航栏默认宽度从 64px 校准成 **51px**。

这是产品层的默认值修正，不改页面壳本身。

## Why this exists

`dsh-pages` is a general-purpose page shell; its 64px default is not every
product's default. Forking the shell or patching `node_modules` would be lost on
the next install, so the product ships its own default instead.

It also never overwrites a user's choice:

- the user has never touched the rail width → it becomes 51px;
- the user (or the manager's "reset width") already set a width → untouched.

The check reads the `railWidth` field in the shell's own preference document,
not "is it currently 64": 64 may be a deliberate choice and must not be rewritten.

## Install

```sh
npm install @lybx-leyw/dsh-zju-pages-default
```

Add it to the profile's `dsh.profile.bundles` **after** `@lybx-leyw/dsh-pages`:

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@lybx-leyw/dsh-pages",
        "@lybx-leyw/dsh-zju-pages-default"
      ]
    }
  }
}
```

## Notes

- Requires `@lybx-leyw/dsh-pages`; without it the package does nothing.
- The directory name in the source repo is `packages/client/pages-default/`;
  the published package name is `@lybx-leyw/dsh-zju-pages-default`.
- No host-side behaviour; the whole package is one client effect.

## License

UNLICENSED — this package is part of the workbench and is not published to npm yet.
The `license` field says `UNLICENSED` on purpose: the publish guard (`tests/publish-guard.test.mjs`)
requires a package to drop both `private: true` **and** any institutional name before it
can ship, so a placeholder MIT header here would only hide that step.
