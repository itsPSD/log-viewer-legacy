# Legacy India Logs

A secure web-based log viewer with Discord authentication for Legacy India server logs.

## Features

- 🔒 Secure Discord authentication
- 👥 User whitelist system
- 📊 Real-time log viewing
- 🎮 Color-coded log categories:
  - Minigames (Purple)
  - Money Transfers (Teal)
  - Drug Logs (Yellow)
  - Connect Logs (Green)
  - Disconnect Logs (Red)
- 🔍 Advanced search and filtering
- ⚡ Fast and responsive UI

## Setup

1. Clone the repository
```bash
git clone <repository-url>
cd <repository-name>
```

2. Install dependencies
```bash
npm install
```

3. Create environment file
```bash
cp .env.example .env
```

4. Configure environment variables in `.env`:
```env
PORT=3000
DB_HOST=localhost
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=your_db_name

# Discord OAuth2 Credentials
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
DISCORD_CALLBACK_URL=your_discord_callback_url

# Session Secret
SESSION_SECRET=your_session_secret
```

5. Configure allowed Discord users in `config.js`:
```javascript
allowedUsers: [
    "your_discord_id",  // Add Discord user IDs
]
```

6. Start the server
```bash
npm start
```

## Discord Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to OAuth2 settings
4. Add redirect URL: `http://localhost:3000/auth/discord/callback`
5. Copy Client ID and Client Secret to your `.env` file

## Security

- Only whitelisted Discord users can access the logs
- Session-based authentication
- Protected API routes
- Environment variable configuration
- Secure password and key storage

## Tech Stack

- Node.js & Express
- MySQL Database
- Discord OAuth2
- Tailwind CSS
- Font Awesome Icons

## License

Private and Confidential - Legacy India
