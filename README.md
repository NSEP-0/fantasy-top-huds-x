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
- `test.mjs` - Test script to check Fantasy Top market data without posting to Twitter

## Usage
To run the bot and post to Twitter, run:
```bash
npm start
```
or
```bash
node bot.mjs
```

### Testing Without Posting to Twitter
The `test.mjs` script allows you to check Fantasy Top market data without posting to Twitter.

Basic usage:
```bash
node test.mjs hero_name
```

Additional testing options:
```bash
# Get help and see all available options
node test.mjs --help

# Test supply data for a specific hero
node test.mjs hero_name --supply

# Test detailed price data across all rarity levels
node test.mjs hero_name --prices
```

Examples:
```bash
node test.mjs rasmr              # Test market info for rasmr
node test.mjs orangie --supply   # Test supply data for orangie
node test.mjs TylerDurden --prices  # Test price data for TylerDurden
node test.mjs vydamo_            # Test market info for vydamo_
```

Example Twitter Post:
```
rasmr_eth

Legendary: 1 cards
Epic: 8 cards (Last: Ξ1.900, Bid: Ξ1.040)
Rare: 54 cards (Price: Ξ0.631, Last: Ξ0.470, Bid: Ξ0.382)
Common: 146 cards (Price: Ξ0.100, Last: Ξ0.096, Bid: Ξ0.088)

Check out more on Fantasy Top!
```

Example test.mjs output:
```
=== RAW HERO DATA ===
{
  "id": "423164349",
  "name": "rasmr_eth",
  "profileImage": "https://pbs.twimg.com/profile_images/1831904183001247744/ALdr5oD1_normal.jpg",
  "followers": "106992",
  "stars": 7,
  "marketInfo": {
    "1": {
      "rarity": 1,
      "rarityName": "Legendary",
      "supply": 1,
      "highestBid": null,
      "lastSellPrice": null,
      "floorPrice": ""
    },
    "2": {
      "rarity": 2,
      "rarityName": "Epic",
      "supply": 8,
      "highestBid": "1040000000000000000",
      "lastSellPrice": "1900000000000000000",
      "floorPrice": ""
    },
    // ... more rarity levels ...
  }
}

=== HERO MARKET INFORMATION ===
Name: rasmr_eth
ID: 423164349
Followers: 106992
Stars: 7

--- Market Data By Rarity ---

Legendary (Rarity Level: 1):
  Supply: 1
  Current Price (Lowest Asking Price):
    Raw: N/A
    ETH: 0.000000
  Last Sell Price:
    Raw: N/A
    ETH: N/A
  Highest Bid:
    Raw: N/A
    ETH: N/A

// ... more rarity levels ...
```

## Error Handling

- If Twitter credentials are invalid, the bot will prompt for reauthorization
- API errors are logged to the console
- Missing environment variables will trigger appropriate error messages

## Notes

- The bot posts hero information including:
  - Name and supply by rarity level
  - Floor prices (lowest asking prices) in ETH
  - Last sell prices in ETH
  - Current highest bids in ETH
- Tokens are stored locally in `tokens.json` after initial authorization
- Wei values (blockchain currency denominations) are automatically converted to ETH for readability

## Next Steps
1. Add functionality to automatically schedule tweets
2. Implement tracking of price changes over time
3. Add support for multiple heroes in a single run
