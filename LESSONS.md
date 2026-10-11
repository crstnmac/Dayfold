# Design lessons
- Hard-coded `px-6` in rows drifted 8px from `--card-spacing` card headers. Use the token.
- Fixed toast offsets cover the command bar once the footer wraps; measure the footer.
- Header tabs must collapse before they clip; test at 480 / 820 / 1360.
- Keep e2e hooks (aria-labels like "Deadline for X", "To-do today") when restyling.
