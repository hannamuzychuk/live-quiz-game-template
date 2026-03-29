# Live Quiz Game — WebSocket Server

This project is a **real-time quiz game** server built with WebSocket (`ws`).  
Players can register, create games, join games, answer questions, and get live scoring with a speed bonus.

---

## Features

- WebSocket server supports multiple simultaneous connections
- Player registration and login (`reg`)
- Game creation with question validation
- Join game using a 6-character game code
- Start game (host only)
- Real-time question broadcast
- Submit answers and calculate scores with speed bonus
- Broadcast question results after the timer
- End-of-game scoreboard with ranks
- Handles player disconnects gracefully

---

## Technical Details

- **Language:** TypeScript
- **Libraries:** `ws` (WebSocket), `uuid` (unique IDs)
- **Data Storage:** In-memory objects (`users`, `players`, `games`)
- **Game Flow:**  
  1. Player registers → receives `userId`  
  2. Host creates a game → generates 6-character code  
  3. Players join → broadcast `player_joined` and `update_players`  
  4. Host starts the game → sends questions  
  5. Players answer → scores calculated with speed bonus  
  6. Question results broadcast → next question starts automatically  
  7. Game ends → final scoreboard broadcasted  

---

## Running the server

1. **Install dependencies**  
```bash
npm install 

2. **Run server**
```bash
node dist/server.js

3. Server runs on ws://localhost:3000 by default. You can set a custom port using the PORT environment variable.

## WebSocket Message Types
| Type                  | Data                                                            | Description                               |
| -----------------     | ----------------------------------------------------------------| ----------------------------------------- |
| `reg`                 | `{ name, password }`                                            | Register player                           |
| `create_game`         | `{ questions: Question[] }`                                     | Create a new game                         |
| `join_game`           | `{ code: string }`                                              | Join an existing game by code             |
| `start_game`          | `{ gameId }`                                                    | Start the game (host only)                |
| `answer`              | `{ gameId, questionIndex, answerIndex }`                        | Submit answer                             |
| `player_joined`       | `{ playerName, playerCount }`                                   | Broadcast when a player joins             |
| `update_players`      | `{ name, index, score }[]`                                      | Broadcast current player list with scores |
| `question`            | `{ questionNumber, totalQuestions, options, timeLimitSec }`     | Broadcast new question                    |
| `question_result`     | `{ questionIndex, correctIndex, playerResults }`                | Broadcast results after a question        |
| `game_finished`       | `{ scoreboard }`                                                | Broadcast final results                   |
| `error`               | `{ message }`                                                   | Error messages                            |
