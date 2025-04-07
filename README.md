# Fantasy Top Twitter Bot

A Twitter bot that responds to mentions with information about Fantasy Top heroes. The bot helps connect Twitter users to the Fantasy.top ecosystem by providing hero market data in response to mentions.

## Features

- Responds to mentions asking about Fantasy.top heroes
- Provides market data including supply, floor price, and last sale price
- Supports multiple rarity levels (Common, Rare, Epic, Legendary)
- Intelligent hero name extraction from tweets
- Persistent state management across restarts
- Automatic rate limiting and error handling

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/ftopper_v0.git
cd ftopper_v0
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file with required credentials (see Configuration section below)

4. Run the bot:
```bash
node bot.mjs
```

## Configuration

Create a `.env` file in the project root with the following variables: