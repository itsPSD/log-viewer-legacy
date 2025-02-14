module.exports = {
    discord: {
        clientId: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        callbackURL: process.env.DISCORD_CALLBACK_URL || 'http://localhost:3000/auth/discord/callback',
    },
    
    allowedUsers: [

        "697694922274242620", //PSD
        "438426740038172673", //Ravi
    ]
};
