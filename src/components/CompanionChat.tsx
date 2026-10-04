import { useState } from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LucideIcon, Send, MessagesSquare, User } from 'lucide-react';
import { acosSimulationService } from '../services/acosSimulation';

const CompanionChat = () => {
  const [messages, setMessages] = useState([
    { id: 1, text: "Hello! I'm your AI companion. How can I assist you today?", isUser: false },
    { id: 2, text: "Hi! Can you tell me about the ACOS system?", isUser: true },
    { id: 3, text: "ACOS is the AI Companion Operating System that provides a secure environment for AI companions to operate. It enforces boundaries between companion behavior and system authority.", isUser: false },
  ]);
  const [input, setInput] = useState('');

  const sendMessage = async () => {
    if (!input.trim()) return;
    const newMessage = {
      id: Date.now(),
      text: input,
      isUser: true,
    };
    setMessages([...messages, newMessage]);
    setInput('');

    // Simulate companion response by creating an operation
    try {
      const operation = await acosSimulationService.createOperation('chat.send', `Send message: "${input}"`);
      // In a real system, the companion response would come from the operation result
      // For now, we'll simulate a response based on the operation
      const response = {
        id: Date.now() + 1,
        text: `I received your message: "${input}". This is a response from the companion via ACOS operation ${operation.id}.`,
        isUser: false,
      };
      setMessages(prev => [...prev, response]);
    } catch (error) {
      // If operation creation fails, still show a simulated response
      const response = {
        id: Date.now() + 1,
        text: `I received your message: "${input}". (Note: ACOS operation creation failed: ${error instanceof Error ? error.message : 'Unknown error'})`,
        isUser: false,
      };
      setMessages(prev => [...prev, response]);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center space-x-3 mb-4">
        <MessagesSquare className="w-6 h-6 text-cyan-400" />
        <h3 className="font-semibold text-cyan-300">Companion Chat</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.isUser ? 'justify-end' : 'justify-start'} max-w-[80%]`}>
            <div className={`rounded-lg px-4 py-2 max-w-xs ${msg.isUser
              ? 'bg-cyan-500/20 text-cyan-200 ml-4'
              : 'bg-white/10 text-white mr-4'}`}>
              {msg.text}
            </div>
            {!msg.isUser && (
              <User className="w-4 h-4 mt-1 text-cyan-400 mr-2 hidden md:block" />
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center space-x-3 p-4 border-t border-white/10">
        <Input
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          className="flex-1"
        />
        <Button onClick={sendMessage} variant="outline">
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};

export default CompanionChat;