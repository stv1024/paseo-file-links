File Links replaces the right-click menu on local file links and images in agent replies. Right-click a link or an image to:

- **Show in Folder**: select the file in File Explorer or Finder. A folder link opens the folder.
- **Open**: open the file with its default app.
- **Copy Path**: copy the absolute path.
- **Copy Image**: copy the image (images only).

An image shows the file items only when its source is a local file. Images that an agent reads are often temporary copies, so the folder can be a temp folder.

It works with Windows paths (`D:\a\b.mp3`), `file://` URLs, absolute POSIX paths, `~/` paths, and paths relative to the workspace. Line suffixes such as `:42` or `#L42` are ignored, so the menu acts on the file. Left-click keeps Paseo's own behavior.

The daemon runs the file manager, so the folder opens on the computer that runs the daemon. The menu is available in the desktop and web app, not in the mobile app.
