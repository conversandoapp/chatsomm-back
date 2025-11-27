// server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors({
  origin: process.env.FRONTEND_URL || '*', // En producción especifica tu frontend
  credentials: true
}));
app.use(express.json());

// Ruta de health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Chat Backend API is running',
    timestamp: new Date().toISOString()
  });
});

// Endpoint principal del chat
app.post('/api/chat', async (req, res) => {
  try {
    const { message, conversationHistory } = req.body;

    // Validación
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ 
        error: 'Message is required and must be a string' 
      });
    }

    // Preparar mensajes para OpenAI
    const messages = [
      // System prompt (opcional - personaliza el comportamiento del bot)
      {
        role: 'system',
        content: 'Eres un asistente útil y amigable. Respondes de manera clara y concisa.'
      },
      // Historial de conversación
      ...(conversationHistory || []).map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      // Mensaje actual del usuario
      {
        role: 'user',
        content: message
      }
    ];

    // Llamada a la API de OpenAI
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4',
        messages: messages,
        temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.7'),
        max_tokens: parseInt(process.env.OPENAI_MAX_TOKENS || '1000'),
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenAI API Error:', errorData);
      
      return res.status(response.status).json({
        error: 'Error from OpenAI API',
        details: errorData.error?.message || 'Unknown error'
      });
    }

    const data = await response.json();
    const botResponse = data.choices[0].message.content;

    // Responder al frontend
    res.json({
      response: botResponse,
      model: data.model,
      usage: data.usage // Información de tokens usados
    });

  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Manejo de rutas no encontradas
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🤖 Using model: ${process.env.OPENAI_MODEL || 'gpt-4'}`);
});
