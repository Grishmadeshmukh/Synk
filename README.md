# Synk MVP

Simple room-based watch party app with:
- MP4 upload and shared playback
- YouTube link sharing (embedded)
- Other public video/embed links
- Live room chat

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000` in two browser tabs/devices.

## Deploy on Render (free tier)

1. Push this repo to GitHub.
2. Go to [Render](https://render.com/) and create a new **Web Service**.
3. Connect your GitHub repo.
4. Render will detect `render.yaml` automatically.
5. Deploy and share the generated URL.

Notes:
- Free services can sleep after inactivity, so first load may take a bit.
- This app is session-based/in-memory. If the service restarts, room session state resets.

## How to use

1. Enter the same Room ID on both users.
2. Join the room.
3. Pick one source:
   - Upload MP4
   - Paste YouTube link
   - Paste direct `.mp4` URL or embeddable URL
4. Play/pause/seek on MP4 sources to sync with the room.
5. Use chat on the right side.
6. Use the fullscreen button above the player to enter fullscreen while keeping chat visible.

## Notes and limitations

- DRM platforms (Netflix, Prime Video, etc.) cannot be supported through embedding due to legal/technical restrictions.
- Playback sync is implemented for HTML5 video (`mp4`); YouTube/embed sync is not yet implemented in this MVP.
- Uploaded videos are temporary and tied to a room session.
- MP4 uploads are automatically deleted when the last participant leaves the room.

## Next improvements

- Implement YouTube IFrame API sync.
- Add authentication and private rooms.
- Persist chat/video state to a database (Redis/Postgres).
- Add deployment (Render/Railway/Fly.io + object storage for uploads).
