# E09: Album explorer MCP App

This standalone example adds an interactive MCP Apps view to the existing E01 public album lookup capability. It imports E01's shared album definition and data. There is no parallel catalog endpoint.

From the repository root, run npm run example:e09. The checker packs the package, installs E09 in an isolated folder, bundles the vanilla view, runs protocol and negative-path tests, and starts a text-only MCP client demo.

The positive fixture uses the official ext-apps App and AppBridge classes and the official MCP client/server packages. It receives a tool result in the view, then performs a second lookup through App.callServerTool; the host bridges that call to the MCP server. The demo prints text and structured tool results for hosts that do not render views.

Tests cover a found and missing album, a policy-denied call with zero binding side effect, malformed host input and result data, text fallback, allowed UI MIME/URI, an undeclared resource, invalid URI, undeclared capability, and an external-origin resource.

The view makes no direct network requests and declares empty CSP origin lists. The fixture uses a simulated app channel and local HTTP server; it does not verify browser iframe sandboxing or a real MCP Apps host. Real host validation remains UAN-023.
