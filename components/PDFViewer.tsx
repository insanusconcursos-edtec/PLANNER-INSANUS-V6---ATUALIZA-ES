import React from 'react';
import { User } from '../types';

interface PDFViewerProps {
    url: string;
    user: User;
    onClose: () => void;
}

export const PDFViewer: React.FC<PDFViewerProps> = ({ url, user, onClose }) => {
    return (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
            <div className="h-12 bg-insanus-gray border-b border-gray-700 flex justify-between items-center px-4">
                <span className="text-sm font-mono text-gray-400">Leitor Seguro de Documentos</span>
                <button onClick={onClose} className="text-white hover:text-insanus-red">Fechar</button>
            </div>
            <div className="flex-1 relative bg-white overflow-hidden flex justify-center items-center">
                
                {/* Simulated PDF Content (Since we can't load real cross-origin PDFs easily in demo) */}
                <div className="w-full h-full overflow-auto bg-gray-200 p-8 flex flex-col items-center gap-4">
                     <div className="w-[210mm] h-[297mm] bg-white shadow-xl p-12 text-black relative">
                        <h1 className="text-3xl font-bold mb-6">Material de Estudo</h1>
                        <p className="mb-4">Este é um documento PDF protegido.</p>
                        <p className="text-justify text-gray-600">
                            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. 
                            Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
                        </p>
                        <div className="mt-8 border-l-4 border-red-500 pl-4 italic">
                            Conteúdo exclusivo para assinantes.
                        </div>
                     </div>
                </div>

                {/* Watermark Overlay */}
                <div className="absolute inset-0 pointer-events-none flex flex-wrap content-center justify-center overflow-hidden opacity-20 select-none">
                    {Array.from({ length: 20 }).map((_, i) => (
                        <div key={i} className="transform -rotate-45 p-12 text-red-600 font-bold text-xl whitespace-nowrap">
                            {user.name} - {user.cpf}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};