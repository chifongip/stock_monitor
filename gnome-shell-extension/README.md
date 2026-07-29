# GNOME Shell Extension

`stock-monitor@local` is a GNOME Shell 42 extension that displays Hong Kong
stock prices in the top bar. It is independent of the Node.js terminal app.

## Package and install

From the repository root, run:

```bash
make extension-package
make extension-install
```

The install target creates
`gnome-shell-extension/build/stock-monitor@local.shell-extension.zip` and
installs it for the current user. Reload GNOME Shell before enabling it: on
Wayland, log out and back in; on Xorg, press `Alt+F2`, type `r`, and press
Enter. Then run:

```bash
make extension-enable
```

Open the extension's Preferences to edit the watchlist and refresh interval.
Enter one Hong Kong stock code per line; `700` is normalized to `00700`.

## Development

Run `make extension-schema` after editing the GSettings XML. Use the
Extensions app or `gnome-extensions disable stock-monitor@local` to disable the
extension before testing a rebuilt package. The default provider is Money18 and
does not require credentials.
