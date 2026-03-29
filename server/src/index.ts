import WebSocket, { WebSocketServer } from 'ws';
import { AnswerData, CreateGameData, Game, JoinGameData, Player, RegData, StartGameData, User, WSMessage } from './types';
import { v4 as uuidv4 } from 'uuid';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

const wss = new WebSocketServer({ port: PORT });
console.log(`WebSocket server running on ws://localhost:${PORT}`);

const users: Record<string, User> = {};
const games: Record<string, Game> = {};
const players: Record<string, Player> = {};

wss.on('connection', (ws: WebSocket) => {
    let currentUserId: string | null = null;

    ws.on('message', (msg) => {
        try{
            const message: WSMessage = JSON.parse(msg.toString());
            handleMessage(ws, message);
        } catch {
            sendError(ws, 'Invalid JSON');
        }
    });

    ws.on('close', () => {
        if (currentUserId) handleDisconnect(currentUserId);
    });

    function handleMessage(ws: WebSocket, msg: any) {
        const {type, data} = msg;

        if (type !== 'reg' && !currentUserId) {
        return sendError(ws, 'Not authenticated');
    }

        switch (type) {
            case 'reg': 
               currentUserId = handleReg(ws, data as RegData);
               break;
            case 'create_game':
                handleCreateGame(ws, data as CreateGameData, currentUserId!);
                break;
            case 'join_game': 
                handleJoinGame(ws, data as JoinGameData, currentUserId!);
                break;
            case 'start_game':
                handleStartGame(currentUserId!, (data as StartGameData).gameId);
                break;
            case 'answer' :
                handleAnswer(currentUserId!, data as AnswerData);
                break;
            default:
                sendError(ws, 'Unknown message type');   
        }
    }
});

function sendError(ws: WebSocket, message: string) {
    ws.send(JSON.stringify({
        type: 'error',
        data: { message },
        id: 0
    }));
}

function handleReg(ws: WebSocket, data: RegData): string {
    const userId = uuidv4();

  const user: User = {
    name: data.name,
    password: data.password,
    index: userId,
    ws
  };

  users[userId] = user;
  const player: Player = {
    name: data.name,
    index: userId,
    score: 0,
    ws
   };
   players[userId] = player;

   ws.send(JSON.stringify({
    type: 'reg',
    data: {name: data.name, index: userId, error: false, errorText: '' },
    id: 0
   }));

   return userId;
}

function handleCreateGame(ws: WebSocket, data: CreateGameData, hostId: string) {
        if (!data.questions?.length) return sendError(ws, 'Invalid questions');

    for (const q of data.questions) {
        if (!q.text || q.options.length !== 4 || q.correctIndex > 3 || q.correctIndex < 0) {
            return sendError(ws, 'Invalid question format');
        }
    }
    
    const gameId = uuidv4();
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();

    const game: Game = {
    id: gameId,
    code,
    hostId,
    questions: data.questions,
    players: [],
    currentQuestion: -1,
    status: 'waiting',
    playerAnswers: new Map()
  };

    game.players.push(players[hostId]);

    games[gameId] = game;

    ws.send(JSON.stringify({
        type: 'game_created',
        data: { gameId, code },
        id: 0
    }));
}

function handleJoinGame(ws: WebSocket, data: JoinGameData, playerId: string) {
    const game = Object.values(games).find(g => g.code === data.code);
    if(!game) {
        return sendError(ws, 'Game not found');
    }

    if (game.players.some(p => p.index === playerId)) return;

   const player = players[playerId];
   game.players.push(player);

   ws.send(JSON.stringify({type: 'game_joined', data: { gameId: game.id }, id: 0 }));

   broadcastToGame(game, {
    type: 'player_joined',
    data: { playerName: player.name, playerCount: game.players.length },
    id: 0
  });
  updatePlayers(game);
}

function handleStartGame(hostId: string, gameId: string) {
    const game = games[gameId];
  if (!game || game.hostId !== hostId || game.players.length === 0){
    return;
  };
  game.status = 'in_progress';
  startQuestion(game);
}

function handleAnswer(playerId: string, data: AnswerData) {
    const game = games[data.gameId];
    if (!game || data.questionIndex !== game.currentQuestion) {
        return;
    }

    if (data.answerIndex < 0 || data.answerIndex > 3) {
        return;
     }

    const player = game.players.find(p => p.index === playerId);
    if (!player || player.hasAnswered) {
        return;
    }

    const now = Date.now();
    player.hasAnswered = true;
    player.answerTime = (now - (game.questionStartTime ?? now)) / 1000;

    game.playerAnswers.set(playerId, {
        answerIndex: data.answerIndex,
        timestamp: Date.now()
    });
    player.ws?.send(JSON.stringify({
        type: 'answer_accepted',
        data: { questionIndex: data.questionIndex },
        id: 0
    }));

    if (game.players.every(p => p.hasAnswered)) {
        clearTimeout(game.questionTimer);
        endQuestion(game);
    }
}

function startQuestion(game: Game) {
    game.currentQuestion +=1;
    if (game.currentQuestion >= game.questions.length) {
        return finishGame(game);
    }
    const q = game.questions[game.currentQuestion];
    game.players.forEach(p => { p.hasAnswered = false; p.answerTime = undefined; });
    game.playerAnswers.clear();
    game.questionStartTime = Date.now();

    broadcastToGame(game, {
        type: 'question',
        data: {
           questionNumber: game.currentQuestion + 1,
           totalQuestions: game.questions.length,
           text: q.text,
           options: q.options,
           timeLimitSec: q.timeLimitSec       
          },
        id: 0
    });

    game.questionTimer = setTimeout(() => endQuestion(game), q.timeLimitSec * 1000);
}

function finishGame(game: Game) {
    game.status = 'finished';
    const scoreboard = [...game.players]
        .sort((a, b) => b.score - a.score)
        .map((p, idx) => ({ name: p.name, score: p.score, rank: idx + 1 }));
    
        broadcastToGame(game, {type: 'game_finished', data: { scoreboard }, id: 0 });
}

function endQuestion(game: Game) {
    const q = game.questions[game.currentQuestion];
    const basePoints = 1000;

    const results = game.players.map(p => {
    const answerObj = game.playerAnswers.get(p.index);
    const correct = answerObj?.answerIndex === q.correctIndex;


        let points = 0;
        if (correct) {
            const timeUsed = p.answerTime ?? q.timeLimitSec;
            const timeFactor = Math.max(0, (q.timeLimitSec - timeUsed) / q.timeLimitSec);
            points = Math.floor(basePoints * timeFactor);
            p.score += points;
        }

      return {
        name: p.name,
        answered: p.hasAnswered,
        correct,
        pointsEarned: points,
        totalScore: p.score
      };  
    });
      
    broadcastToGame(game, {
        type: 'question_result',
        data: { questionIndex: game.currentQuestion, correctIndex: q.correctIndex, playerResults: results },
        id: 0
    });
  setTimeout(() => startQuestion(game), 2000);
}

function broadcastToGame(game: Game, msg: any) {
    game.players.forEach(p => {
        if (p.ws?.readyState === WebSocket.OPEN) {
          p.ws.send(JSON.stringify(msg));
    }
    });
}


function updatePlayers(game: Game) {
    broadcastToGame(game, {
        type: 'update_players',
        data: game.players.map(p => ({ name: p.name, index: p.index, score: p.score })),
        id: 0
    });
}

function handleDisconnect(playerId: string) {
    Object.values(games).forEach(game => {
        const idx = game.players.findIndex(p => p.index === playerId);
        if (idx >= 0) {
            const disconnectedPlayer = game.players[idx];

            if (game.status === 'in_progress' && !disconnectedPlayer.hasAnswered) {
                disconnectedPlayer.hasAnswered = true;
                game.playerAnswers.set(playerId, {
                    answerIndex: -1,
                    timestamp: Date.now()
                });
            }

            game.players.splice(idx, 1);

            updatePlayers(game);

            if (game.status === 'in_progress') {
                if (game.players.every(p => p.hasAnswered)) {
                    clearTimeout(game.questionTimer);
                    endQuestion(game);
                }
            }

            if (game.players.length === 0) {
                delete games[game.id];
            }
        }
    });

    delete players[playerId];
}