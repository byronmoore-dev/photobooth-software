# Third-party notices

Camera Booth includes the separate FFmpeg executable distributed by
`ffmpeg-static` 5.3.0. The Windows binary is an FFmpeg 6.1.1 essentials build
licensed under GNU GPL version 3. Its complete license and upstream build/source
information are installed in the app's `resources/licenses` directory.

- FFmpeg: https://ffmpeg.org/
- Source revision identified by the bundled build: `e38092ef93`
- Binary distributor: https://github.com/eugeneware/ffmpeg-static

FFmpeg runs as an independent child process and receives live-view JPEG frames
over standard input. Camera Booth does not link FFmpeg into its application code.
