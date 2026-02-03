
import { GoogleGenAI, Type } from "@google/genai";
import { Flashcard, MindMapNode } from "../types";
import { uuid } from "../constants";

// Helper para inicializar o cliente apenas quando necessário
const getAIClient = () => {
  // Garante que a chave existe ou usa string vazia para evitar crash imediato
  const apiKey = process.env.API_KEY || ""; 
  if (!apiKey) {
    console.warn("API Key do Google Gemini não encontrada. Verifique as variáveis de ambiente.");
  }
  return new GoogleGenAI({ apiKey });
};

export const generateFlashcardsFromPDF = async (base64Pdf: string): Promise<Flashcard[]> => {
  try {
    const ai = getAIClient();
    
    // Regex robusto para remover qualquer header data: (application/pdf, octet-stream, etc)
    const cleanBase64 = base64Pdf.replace(/^data:.*?;base64,/, "");

    // Using gemini-3-flash-preview for efficiency and compliance with guidelines for basic text tasks
    const modelName = "gemini-3-flash-preview"; 

    const response = await ai.models.generateContent({
      model: modelName,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: cleanBase64,
            },
          },
          {
            text: `Você é um especialista em concursos públicos e pedagogia.
              Analise o documento PDF fornecido.
              Crie uma lista de Flashcards (Perguntas e Respostas) que ajudem na revisão ativa deste conteúdo.
              Foque nos conceitos mais importantes, prazos, exceções e regras gerais que costumam cair em provas.
              As perguntas devem ser diretas e as respostas explicativas porém concisas.
              Gere entre 5 a 15 flashcards, dependendo da densidade do conteúdo.
              Retorne APENAS o JSON conforme o schema.`,
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: {
                type: Type.STRING,
                description: "A pergunta do flashcard, deve estimular a memória ativa.",
              },
              answer: {
                type: Type.STRING,
                description: "A resposta correta e concisa.",
              },
            },
            propertyOrdering: ["question", "answer"],
          },
        },
      },
    });

    const jsonText = response.text;
    if (!jsonText) {
        throw new Error("Não foi possível gerar flashcards (resposta vazia).");
    }

    // Clean potential markdown blocks just in case
    const cleanedText = jsonText.replace(/```json|```/g, '').trim();
    const rawCards = JSON.parse(cleanedText) as { question: string; answer: string }[];

    // Map to internal Flashcard type with UUIDs
    return rawCards.map(card => ({
      id: uuid(),
      question: card.question,
      answer: card.answer
    }));

  } catch (error) {
    console.error("Erro ao gerar flashcards com Gemini:", error);
    throw new Error("Falha ao processar o arquivo com IA. Verifique se o PDF contém texto selecionável.");
  }
};

// NEW: Generate Mind Map from multiple PDFs
export const generateMindMapFromFiles = async (files: { base64: string, mimeType: string }[]): Promise<MindMapNode> => {
    try {
        const ai = getAIClient();
        const modelName = "gemini-3-flash-preview";
        
        const parts = files.map(f => ({
            inlineData: {
                // Força application/pdf se o navegador mandou algo genérico como octet-stream
                mimeType: (f.mimeType && f.mimeType.includes('pdf')) ? f.mimeType : 'application/pdf',
                // Regex universal para limpar o header data:...base64,
                data: f.base64.replace(/^data:.*?;base64,/, '')
            }
        }));

        // Prompt reforçado para garantir JSON correto sem precisar do Schema validador que causa erro
        parts.push({
            // @ts-ignore - The types for parts are union types, string is valid for text part
            text: `Analise os documentos fornecidos e crie um MAPA MENTAL DIDÁTICO e estruturado.
            
            REGRAS OBRIGATÓRIAS DE SAÍDA:
            1. Retorne APENAS um objeto JSON válido. Não use Markdown (\`\`\`json).
            2. O JSON deve representar uma árvore de nós.
            3. A estrutura de cada nó deve ser: { "label": "Nome do Tópico", "children": [ ... outros nós ... ] }
            4. O nó raiz deve ser o Tópico Central dos documentos.
            5. A profundidade da árvore deve ser suficiente para cobrir os detalhes importantes (pelo menos 3 níveis se houver conteúdo).
            6. Seja didático e use rótulos curtos.`
        });

        const response = await ai.models.generateContent({
            model: modelName,
            contents: {
                parts: parts as any
            },
            config: {
                // Usamos apenas o MimeType JSON. Removemos responseSchema para evitar erro de recursão (Object empty properties).
                responseMimeType: "application/json", 
            }
        });

        const jsonText = response.text;
        if (!jsonText) throw new Error("Resposta vazia da IA.");
        
        // Clean markdown blocks if present (Common hallucination fix)
        const cleanedText = jsonText.replace(/```json|```/g, '').trim();

        // Helper to ensure UUIDs if model creates generic IDs or no IDs
        const enrichIds = (node: any): MindMapNode => {
            return {
                id: uuid(), 
                label: node.label || node.name || "Sem Rótulo", // Fallback para 'name' caso a IA use esse campo
                children: (node.children && Array.isArray(node.children)) ? node.children.map(enrichIds) : []
            };
        };

        const rawRoot = JSON.parse(cleanedText);
        
        // Validação básica se é um array ou objeto
        const rootNode = Array.isArray(rawRoot) ? rawRoot[0] : rawRoot;
        
        return enrichIds(rootNode);

    } catch (error: any) {
        console.error("Erro detalhado Gemini:", error);
        
        // Better error propagation
        if (error.message && error.message.includes('400')) {
             // Geralmente erro de token limit ou formato inválido
             throw new Error("Erro de processamento da IA. O arquivo pode ser muito complexo ou estar corrompido.");
        }
        throw new Error("Falha na geração do Mapa Mental. Tente novamente.");
    }
}
