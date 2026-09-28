# Extension Host Startup Fix

The extension startup path was hardened so activation performs only lightweight VS Code registration.

## Changes

1. Command registration now accepts VS Code command arguments (`(...args: any[]) => any`).
2. Repository analysis and Copilot calls remain command-driven and do not run during activation.
3. Added activation diagnostics to the Extension Host console:
   - `[Splunk Observability] Extension activation started`
   - `[Splunk Observability] Extension activation completed`
4. Removed `onView:splunkObservability.repositories` from activation events. The extension is activated by its commands instead, avoiding unnecessary activation when the sidebar is merely opened.

## Run

```bash
npm install
npm run compile
```

Then use **Run and Debug -> Run Extension**.

If activation is successful, the Extension Host output contains both startup messages above.
