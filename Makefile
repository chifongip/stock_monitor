EXTENSION_DIR := gnome-shell-extension/stock-monitor@local
EXTENSION_BUILD_DIR := gnome-shell-extension/build
EXTENSION_UUID := stock-monitor@local
EXTENSION_ARCHIVE := $(EXTENSION_BUILD_DIR)/$(EXTENSION_UUID).shell-extension.zip

.PHONY: extension-schema extension-package extension-install extension-enable

extension-schema:
	glib-compile-schemas $(EXTENSION_DIR)/schemas

extension-package: extension-schema
	mkdir -p $(EXTENSION_BUILD_DIR)
	gnome-extensions pack --force --out-dir $(EXTENSION_BUILD_DIR) $(EXTENSION_DIR)

extension-install: extension-package
	gnome-extensions install --force $(EXTENSION_ARCHIVE)
	@echo "Installed $(EXTENSION_UUID). Reload GNOME Shell, then run: make extension-enable"

extension-enable:
	gnome-extensions enable $(EXTENSION_UUID)
