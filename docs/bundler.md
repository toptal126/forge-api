# Bundler Module

The Bundler module provides an independent API for generating memecoin metadata based on news data.

## Features

- **News Integration**: Fetches relevant news using the Brave Search API
- **AI-Powered Generation**: Uses OpenAI to generate memecoin metadata
- **Image Generation**: Creates professional memecoin logos using DALL-E 3
- **No Caching**: Each request generates fresh, unique content (no cached responses)
- **No Database Required**: Stateless API that doesn't require database interactions

## API Endpoints

### GET /bundler/memecoin

Generates memecoin metadata based on a keyword.

#### Query Parameters

- `keyword` (required): The keyword to search for news and generate memecoin metadata

#### Response

Returns a JSON object with the following structure:

```json
{
  "description": "A memecoin description based on the keyword and news",
  "tokenSymbol": "SYMBOL",
  "tokenName": "Token Name",
  "website": "https://example.com",
  "twitter": "@example",
  "image": "https://oaidalleapiprodscus.blob.core.windows.net/..."
}
```

#### Example Request

```bash
GET /bundler/memecoin?keyword=bitcoin
```

#### Example Response

```json
{
  "description": "A revolutionary memecoin inspired by the latest Bitcoin developments and market trends",
  "tokenSymbol": "BTC",
  "tokenName": "Bitcoin Meme",
  "website": "https://bitcoinmeme.com",
  "twitter": "@bitcoinmeme",
  "image": "https://oaidalleapiprodscus.blob.core.windows.net/..."
}
```

#### Error Responses

- **400 Bad Request**: When keyword parameter is missing or empty
- **404 Not Found**: When no news is found for the given keyword
- **500 Internal Server Error**: When there's an error generating metadata

## Configuration

The module requires the following environment variables:

- `BRAVE_API_TOKEN`: API token for Brave Search
- `OPENAI_API_KEY`: API key for OpenAI (DeepSeek)

## How It Works

1. **News Search**: Searches for news related to the provided keyword using Brave Search API
2. **Content Extraction**: Extracts relevant news content from the search results
3. **Fresh AI Generation**: Creates a new OpenAI instance for each request to prevent caching
4. **Unique Content Creation**: Uses high temperature and penalties to ensure unique responses
5. **Image Generation**: Creates a professional memecoin logo using DALL-E 3 with unique prompts
6. **Response**: Returns the generated metadata with image URL in JSON format

### Anti-Caching Features

- **Unique Conversation IDs**: Each request gets a unique conversation identifier
- **Fresh OpenAI Instances**: New OpenAI client created for each request
- **High Temperature**: Uses temperature 0.9 for maximum creativity and variation
- **Penalty Parameters**: Applies frequency and presence penalties to reduce repetition
- **Unique User IDs**: Each request uses a unique user identifier to prevent caching
- **Dynamic Prompts**: Image generation includes unique identifiers in prompts

## Dependencies

- `@nestjs/axios`: For HTTP requests to Brave Search API
- `openai`: For AI-powered metadata generation
- `rxjs`: For reactive programming with observables
