# Fantasy Top HUDS Twitter Bot

A Twitter bot that fetches and posts hero information from Fantasy Top, including supply details, last sell prices, and floor prices for different card rarities.

## Setup

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file with the following variables (fill in with your own values from Fantasy Top and Twitter Auth):

```
CONSUMER_KEY=1234
CONSUMER_SECRET=5678
FTOP_API_KEY=1234-5678-9101-1234-5678
```

The first time you run the bot, it will:
1. Prompt you to authorize the app via Twitter
2. Ask for a PIN from Twitter's authorization page
3. Save the tokens for future use
4. Post a test tweet with hero information for "rasmr"

## File Structure

- `bot.mjs` - Main bot logic and entry point
- `fantasyService.mjs` - Fantasy Top API integration for fetching hero data
- `twitterClient.mjs` - Twitter API integration for posting tweets
- `auth.mjs` - OAuth authentication handling for Twitter

## Usage
To run the bot, simply run:
```bash
npm start
```
To run a test of just the fantasyService, run:
```bash
node fantasyService.mjs "rasmr"
```

Example Output:
```json
Fetching hero info for: rasmr
rasmr_eth 423164349
[
  { rarity: 1, supply: 1 },
  { rarity: 2, supply: 7 },
  { rarity: 3, supply: 76 },
  { rarity: 4, supply: 420 }
]
Hero Info:
{
  "name": "rasmr",
  "supplyDetails": [
    {
      "rarity": 1,
      "supply": 1,
      "lastSellPrice": "N/A",
      "floorPrice": "N/A"
    },
    {
      "rarity": 2,
      "supply": 7,
      "lastSellPrice": "N/A",
      "floorPrice": "N/A"
    },
    {
      "rarity": 3,
      "supply": 76,
      "lastSellPrice": "N/A",
      "floorPrice": "N/A"
    },
    {
      "rarity": 4,
      "supply": 420,
      "lastSellPrice": "N/A",
      "floorPrice": "0.12"
    }
  ]
}
```

## Error Handling

- If Twitter credentials are invalid, the bot will prompt for reauthorization
- API errors are logged to the console
- Missing environment variables will trigger appropriate error messages

## Notes

- The bot currently posts supply details, last sell prices, and floor prices for each rarity level
- Rate limits apply for both Twitter and Fantasy Top APIs
- Tokens are stored locally in `tokens.json` after initial authorization

## Next Steps
1. Identify fix for invalid supply numbers
2. Determine if possible to get "last purchase price" by rarity.
