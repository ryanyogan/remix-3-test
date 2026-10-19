These stylesheets are from @37signals/lexxy 1.0.1 (MIT), the editor used by Fizzy.
Source: https://github.com/basecamp/lexxy
Update these files alongside the package version. The stylesheet files are vendored because
the npm package's exports expose JavaScript only. Runtime JavaScript is bundled from the package by `apps/web/scripts/build-editor.mjs`;
its generated `runtime/` directory is ignored by Git.
