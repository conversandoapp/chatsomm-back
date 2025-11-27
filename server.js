// server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Ruta de health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Chat Backend API is running',
    assistant_id: process.env.OPENAI_ASSISTANT_ID ? 'configured' : 'not configured',
    timestamp: new Date().toISOString()
  });
});

// Endpoint principal del chat con Assistant API
app.post('/api/chat', async (req, res) => {
  try {
    const { message, threadId } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ 
        error: 'Message is required and must be a string' 
      });
    }

    if (!process.env.OPENAI_ASSISTANT_ID) {
      return res.status(500).json({
        error: 'Assistant ID not configured'
      });
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'OpenAI-Beta': 'assistants=v2'
    };

    let currentThreadId = threadId;

    // 1. Crear o usar thread existente
    if (!currentThreadId) {
      const threadResponse = await fetch('https://api.openai.com/v1/threads', {
        method: 'POST',
        headers
      });

      if (!threadResponse.ok) {
        throw new Error('Failed to create thread');
      }

      const threadData = await threadResponse.json();
      currentThreadId = threadData.id;
    }

    // 2. Agregar mensaje del usuario al thread
    const messageResponse = await fetch(`https://api.openai.com/v1/threads/${currentThreadId}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        role: 'user',
        content: message
      })
    });

    if (!messageResponse.ok) {
      const errorData = await messageResponse.json();
      console.error('Error adding message:', errorData);
      throw new Error('Failed to add message to thread');
    }

    // 3. Ejecutar el asistente
    const runResponse = await fetch(`https://api.openai.com/v1/threads/${currentThreadId}/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        assistant_id: process.env.OPENAI_ASSISTANT_ID
      })
    });

    if (!runResponse.ok) {
      const errorData = await runResponse.json();
      console.error('Error creating run:', errorData);
      throw new Error('Failed to run assistant');
    }

    const runData = await runResponse.json();
    const runId = runData.id;

    // 4. Poll hasta que el run se complete
    let runStatus = 'queued';
    let attempts = 0;
    const maxAttempts = 60; // 60 segundos máximo

    while (runStatus !== 'completed' && runStatus !== 'failed' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Esperar 1 segundo

      const statusResponse = await fetch(`https://api.openai.com/v1/threads/${currentThreadId}/runs/${runId}`, {
        headers
      });

      if (!statusResponse.ok) {
        throw new Error('Failed to get run status');
      }

      const statusData = await statusResponse.json();
      runStatus = statusData.status;
      attempts++;

      console.log(`Run status: ${runStatus} (attempt ${attempts})`);

      if (runStatus === 'failed' || runStatus === 'cancelled' || runStatus === 'expired') {
        throw new Error(`Run ${runStatus}: ${statusData.last_error?.message || 'Unknown error'}`);
      }
    }

    if (runStatus !== 'completed') {
      throw new Error('Assistant response timeout');
    }

    // 5. Obtener mensajes del thread
    const messagesResponse = await fetch(`https://api.openai.com/v1/threads/${currentThreadId}/messages`, {
      headers
    });

    if (!messagesResponse.ok) {
      throw new Error('Failed to get messages');
    }

    const messagesData = await messagesResponse.json();
    
    // El mensaje más reciente del asistente es el primero en la lista
    const assistantMessage = messagesData.data.find(msg => msg.role === 'assistant');
    
    if (!assistantMessage) {
      throw new Error('No assistant response found');
    }

// Extraer el texto del contenido y limpiar anotaciones
let responseText = assistantMessage.content
  .filter(content => content.type === 'text')
  .map(content => content.text.value)
  .join('\n');

// Remover anotaciones de citación (ej: 【4:0†source】)
responseText = responseText.replace(/【[^】]*】/g, '');

    // Responder al frontend
    res.json({
      response: responseText,
      threadId: currentThreadId,
      runId: runId
    });

  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Endpoint para crear un nuevo thread (opcional - para reiniciar conversación)
app.post('/api/thread/new', async (req, res) => {
  try {
    const response = await fetch('https://api.openai.com/v1/threads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2'
      }
    });

    if (!response.ok) {
      throw new Error('Failed to create thread');
    }

    const data = await response.json();
    res.json({ threadId: data.id });

  } catch (error) {
    console.error('Error creating thread:', error);
    res.status(500).json({ error: 'Failed to create new thread' });
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
  console.log(`🤖 Using Assistant ID: ${process.env.OPENAI_ASSISTANT_ID || 'NOT CONFIGURED'}`);
});
