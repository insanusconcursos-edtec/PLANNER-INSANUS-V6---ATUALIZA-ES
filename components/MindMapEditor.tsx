import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MindMapNode, MindMapComment, MindMapImage } from '../types';
import { Icon } from './Icons';
import { uuid } from '../constants';
import { uploadFileToStorage } from '../services/storage';

const hexToRgba = (hex: string, alpha: number) => {
    if (!/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) return hex;
    let c = hex.substring(1).split('');
    if (c.length === 3) c = [c[0], c[0], c[1], c[1], c[2], c[2]];
    const r = parseInt(c.slice(0, 2).join(''), 16);
    const g = parseInt(c.slice(2, 4).join(''), 16);
    const b = parseInt(c.slice(4, 6).join(''), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const NEON_COLORS = [
    { name: 'Roxo', value: 'border-purple-500 bg-purple-900/20 text-purple-100 shadow-[0_0_15px_rgba(168,85,247,0.4)]', dot: 'bg-purple-500' },
    { name: 'Azul', value: 'border-blue-500 bg-blue-900/20 text-blue-100 shadow-[0_0_15px_rgba(59,130,246,0.4)]', dot: 'bg-blue-500' },
    { name: 'Verde', value: 'border-green-500 bg-green-900/20 text-green-100 shadow-[0_0_15px_rgba(34,197,94,0.4)]', dot: 'bg-green-500' },
    { name: 'Vermelho', value: 'border-red-500 bg-red-900/20 text-red-100 shadow-[0_0_15px_rgba(239,68,68,0.4)]', dot: 'bg-red-500' },
    { name: 'Amarelo', value: 'border-yellow-500 bg-yellow-900/20 text-yellow-100 shadow-[0_0_15px_rgba(234,179,8,0.4)]', dot: 'bg-yellow-500' },
    { name: 'Ciano', value: 'border-cyan-500 bg-cyan-900/20 text-cyan-100 shadow-[0_0_15px_rgba(6,182,212,0.4)]', dot: 'bg-cyan-500' },
];

const EMOJI_LIST = ["⭐", "✅", "❌", "⚠️", "💡", "🔥", "🚩", "📌", "1️⃣", "2️⃣", "3️⃣", "➡️", "❓", "❗", "🧠", "📚", "🎯", "💰", "⚖️", "🛑"];

const POSTIT_COLORS = [
    { name: 'Amarelo', hex: '#fef3c7' }, // yellow-100
    { name: 'Azul', hex: '#dbeafe' }, // blue-100
    { name: 'Verde', hex: '#dcfce7' }, // green-100
    { name: 'Rosa', hex: '#fce7f3' }, // pink-100
    { name: 'Roxo', hex: '#f3e8ff' }, // purple-100
];

// --- VISUAL RENDERER (Read-Only/Display) ---
interface VisualNodeRendererProps {
    node: MindMapNode;
    selectedId: string | null;
    onSelect: (id: string) => void;
    depth?: number;
    isRoot?: boolean;
    // New prop to delete a comment (passed from parent if allowed)
    onDeleteComment?: (nodeId: string, commentId: string) => void;
    // New prop to edit a comment
    onEditComment?: (nodeId: string, comment: MindMapComment) => void;
    // Drag and Drop Props
    onMoveNode?: (sourceId: string, targetId: string) => void;
}

export const VisualNodeRenderer: React.FC<VisualNodeRendererProps> = ({ node, selectedId, onSelect, depth = 0, isRoot = false, onDeleteComment, onEditComment, onMoveNode }) => {
    const [showComments, setShowComments] = useState(false);
    // FIXED: Alterado para isRoot para garantir expansão gradual
    const [expanded, setExpanded] = useState(isRoot); 
    const [isDragOver, setIsDragOver] = useState(false); // Visual feedback for drop target
    const hasChildren = node.children && node.children.length > 0;
    const isSelected = selectedId === node.id;
    const hasComments = node.comments && node.comments.length > 0;
    const image = node.image;

    let colorClass = '';
    let customStyle: React.CSSProperties = {};
    const isCustom = node.color && node.color.startsWith('#');

    if (isCustom && node.color) {
        customStyle = {
            borderColor: node.color,
            backgroundColor: hexToRgba(node.color, 0.2),
            color: '#f3f4f6',
            boxShadow: isSelected ? `0 0 20px ${hexToRgba(node.color, 0.6)}` : `0 0 10px ${hexToRgba(node.color, 0.3)}`
        };
    } else if (node.color) {
        colorClass = node.color;
    } else {
        const levelColors = [
            NEON_COLORS[0].value,
            'border-pink-500 bg-pink-900/10 text-pink-200',
            'border-blue-500 bg-blue-900/10 text-blue-200',
            'border-green-500 bg-green-900/10 text-green-200',
            'border-yellow-500 bg-yellow-900/10 text-yellow-200'
        ];
        colorClass = isRoot ? levelColors[0] : levelColors[Math.min(depth, levelColors.length - 1)];
    }

    // Image Positioning Logic
    const flexDir = image?.position === 'top' ? 'flex-col' : 
                    image?.position === 'bottom' ? 'flex-col-reverse' : 
                    image?.position === 'left' ? 'flex-row' : 
                    'flex-row-reverse';

    const maxImageSize = 150; // Base px size
    const imageSizeStyle = image ? {
        width: `${maxImageSize * image.scale}px`,
        maxWidth: 'none', // Allow scaling up
    } : {};

    // --- DRAG AND DROP HANDLERS ---
    const handleDragStart = (e: React.DragEvent) => {
        if (isRoot) {
            e.preventDefault(); // Cannot drag root
            return;
        }
        e.dataTransfer.setData('nodeId', node.id);
        e.stopPropagation();
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault(); // Allow drop
        e.stopPropagation();
        if (!isDragOver) setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        const sourceId = e.dataTransfer.getData('nodeId');
        if (sourceId && sourceId !== node.id && onMoveNode) {
            onMoveNode(sourceId, node.id);
        }
    };

    return (
        <div className="flex items-center">
            <div className="flex flex-col items-center relative z-10 group">
                <div 
                    draggable={!isRoot && !!onMoveNode}
                    onDragStart={handleDragStart}
                    onDragOver={onMoveNode ? handleDragOver : undefined}
                    onDragLeave={onMoveNode ? handleDragLeave : undefined}
                    onDrop={onMoveNode ? handleDrop : undefined}
                    onClick={(e) => { e.stopPropagation(); onSelect(node.id); }}
                    style={customStyle}
                    className={`
                        relative px-6 py-3 rounded-2xl border-2 transition-all cursor-pointer transform duration-200
                        ${colorClass}
                        ${isSelected && !isCustom ? 'ring-4 ring-white scale-105 z-20 brightness-110 shadow-xl' : 'hover:scale-105 hover:brightness-110'}
                        ${isDragOver ? '!bg-white/20 !border-white scale-110 shadow-[0_0_30px_white]' : ''}
                        min-w-[120px] max-w-[300px] text-center backdrop-blur-md select-none flex items-center justify-center
                    `}
                >
                    <div className={`flex items-center justify-center gap-2 ${flexDir}`}>
                        {image && (
                            <img 
                                src={image.url} 
                                alt="Node attachment" 
                                className="object-contain bg-transparent pointer-events-none"
                                style={imageSizeStyle}
                            />
                        )}
                        <span 
                            className={`font-bold leading-tight ${isRoot ? 'text-sm uppercase tracking-wider' : 'text-xs'}`}
                            dangerouslySetInnerHTML={{ __html: node.label || '' }}
                        />
                    </div>
                    
                    {/* Post-It Indicator */}
                    {hasComments && (
                        <div 
                            onClick={(e) => { e.stopPropagation(); setShowComments(!showComments); }}
                            className="absolute -top-3 -right-3 cursor-pointer z-30 transition-transform hover:scale-110"
                            title="Ver Post-Its"
                        >
                            <div className="w-6 h-6 bg-yellow-200 rounded-sm shadow-md border border-yellow-400 flex items-center justify-center transform rotate-6">
                                <span className="text-[10px] font-bold text-yellow-800">{node.comments!.length}</span>
                            </div>
                        </div>
                    )}

                    {/* EXPAND/COLLAPSE TOGGLE */}
                    {hasChildren && (
                        <div 
                            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                            className={`
                                absolute -right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full 
                                bg-[#121212] border border-white/30 flex items-center justify-center 
                                text-[10px] shadow-lg transition-transform z-30 hover:bg-white/20 hover:scale-110 cursor-pointer
                            `}
                            title={expanded ? "Recolher" : "Expandir"}
                        >
                            {expanded ? <span className="font-bold text-white text-[10px]">-</span> : <span className="font-bold text-white text-[10px]">+</span>}
                        </div>
                    )}
                </div>

                {/* Expanded Post-Its (PORTAL) */}
                {showComments && hasComments && createPortal(
                    <div 
                        className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in p-4 cursor-default"
                        onClick={(e) => { 
                            e.preventDefault(); 
                            e.stopPropagation(); 
                            setShowComments(false); 
                        }}
                    >
                        <div 
                            className="flex flex-wrap gap-6 justify-center items-center max-w-7xl max-h-[90vh] overflow-y-auto custom-scrollbar p-10"
                            onClick={(e) => e.stopPropagation()} 
                        >
                            {node.comments!.map((comment, idx) => (
                                <div 
                                    key={comment.id} 
                                    className="p-6 rounded-lg shadow-2xl text-black text-sm relative w-80 min-h-[220px] flex flex-col font-medium border border-black/10 transition-transform hover:scale-105 hover:z-50 duration-300"
                                    style={{ 
                                        backgroundColor: comment.backgroundColor, 
                                        transform: `rotate(${idx % 2 === 0 ? '-2deg' : '2deg'})`
                                    }}
                                >
                                    {/* Tape effect */}
                                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-20 h-6 bg-white/30 backdrop-blur-sm -rotate-1 border border-white/20 shadow-sm opacity-60"></div>
                                    
                                    <div className="flex-1 overflow-y-auto custom-scrollbar mb-2 pr-1">
                                        <div dangerouslySetInnerHTML={{ __html: comment.content }} className="rich-text-content prose prose-sm max-w-none leading-relaxed text-black/90 font-serif"/>
                                    </div>
                                    
                                    <div className="mt-auto pt-3 border-t border-black/10 flex justify-between items-center">
                                        <span className="text-[10px] text-black/50 font-mono font-bold uppercase">{new Date(comment.createdAt).toLocaleDateString()}</span>
                                        <div className="flex gap-1">
                                            {onEditComment && (
                                                <button 
                                                    onClick={(e) => { 
                                                        e.stopPropagation(); 
                                                        setShowComments(false);
                                                        onEditComment(node.id, comment);
                                                    }}
                                                    className="text-black/40 hover:text-blue-600 transition p-1.5 hover:bg-black/5 rounded-full"
                                                    title="Editar Post-it"
                                                >
                                                    <Icon.Edit className="w-4 h-4"/>
                                                </button>
                                            )}
                                            {onDeleteComment && (
                                                <button 
                                                    onClick={(e) => { 
                                                        e.stopPropagation(); 
                                                        setShowComments(false);
                                                        onDeleteComment(node.id, comment.id); 
                                                    }}
                                                    className="text-black/40 hover:text-red-600 transition p-1.5 hover:bg-black/5 rounded-full"
                                                    title="Excluir Post-it"
                                                >
                                                    <Icon.Trash className="w-4 h-4"/>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-white/50 text-[10px] font-bold uppercase tracking-widest pointer-events-none bg-black/50 px-4 py-2 rounded-full backdrop-blur-md">
                            Clique fora para fechar
                        </div>
                    </div>,
                    document.body
                )}
            </div>

            {expanded && hasChildren && (
                <div className="flex items-center animate-fade-in">
                    <div className="w-8 h-0.5 bg-gray-600/50"></div>
                    <div className="flex flex-col relative">
                        {node.children!.map((child, index) => (
                            <div key={child.id} className="flex items-center relative py-2">
                                <div className="h-full absolute left-0 w-0.5 bg-gray-600/50 -translate-x-0.5" style={{
                                    top: index === 0 ? '50%' : '0',
                                    height: index === 0 || index === node.children!.length - 1 ? '50%' : '100%',
                                    display: node.children!.length === 1 ? 'none' : 'block'
                                }}></div>
                                <div className="w-6 h-0.5 bg-gray-600/50"></div>
                                <VisualNodeRenderer 
                                    node={child} 
                                    depth={depth + 1} 
                                    selectedId={selectedId} 
                                    onSelect={onSelect} 
                                    onDeleteComment={onDeleteComment}
                                    onEditComment={onEditComment}
                                    onMoveNode={onMoveNode}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

// --- POST-IT EDITOR MODAL ---
interface PostItModalProps {
    onSave: (content: string, color: string) => void;
    onClose: () => void;
    initialContent?: string;
    initialColor?: string;
}

const PostItModal: React.FC<PostItModalProps> = ({ onSave, onClose, initialContent = '', initialColor }) => {
    const [content, setContent] = useState(initialContent);
    const [bgColor, setBgColor] = useState(initialColor || POSTIT_COLORS[0].hex);
    const editorRef = useRef<HTMLDivElement>(null);

    // Initial content setup for contentEditable
    useEffect(() => {
        if (editorRef.current && initialContent) {
            editorRef.current.innerHTML = initialContent;
        }
    }, [initialContent]);

    const execCmd = (command: string, value: string | undefined = undefined) => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();
        document.execCommand(command, false, value);
    };

    const handleSave = () => {
        if (editorRef.current) {
            onSave(editorRef.current.innerHTML, bgColor);
        }
    };

    return (
        <div className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-[#1A1A1A] p-6 rounded-2xl border border-white/10 shadow-2xl max-w-sm w-full">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-white font-bold uppercase text-sm">Novo Post-It</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-white"><Icon.LogOut className="w-4 h-4"/></button>
                </div>

                {/* Toolbar */}
                <div className="flex flex-wrap gap-1 bg-black/40 p-2 rounded-t-lg border border-white/5 border-b-0">
                    {['bold', 'italic', 'underline', 'strikeThrough'].map(cmd => (
                        <button key={cmd} onClick={() => execCmd(cmd)} className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 text-gray-300 text-xs uppercase font-serif">
                            {cmd === 'strikeThrough' ? 'S' : cmd[0]}
                        </button>
                    ))}
                    <div className="w-px h-4 bg-white/10 mx-1 self-center"></div>
                    <div className="relative w-6 h-6 overflow-hidden rounded group/col cursor-pointer">
                        <div className="absolute inset-0 flex items-center justify-center bg-transparent hover:bg-white/10 text-gray-300 font-bold text-xs">A</div>
                        <input type="color" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => execCmd('foreColor', e.target.value)} />
                    </div>
                    <div className="relative w-6 h-6 overflow-hidden rounded group/hi cursor-pointer">
                        <div className="absolute inset-0 flex items-center justify-center bg-transparent hover:bg-white/10 text-gray-300"><Icon.Edit className="w-3 h-3 text-yellow-500"/></div>
                        <input type="color" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => execCmd('hiliteColor', e.target.value)} />
                    </div>
                </div>

                {/* Editor Area */}
                <div 
                    ref={editorRef}
                    contentEditable
                    className="p-4 min-h-[150px] outline-none text-sm shadow-inner rounded-b-lg mb-4 text-black overflow-y-auto"
                    style={{ backgroundColor: bgColor }}
                ></div>

                {/* Color Picker */}
                <div className="flex gap-2 mb-6 justify-center">
                    {POSTIT_COLORS.map(c => (
                        <button 
                            key={c.hex}
                            onClick={() => setBgColor(c.hex)}
                            className={`w-6 h-6 rounded-full border-2 transition-transform ${bgColor === c.hex ? 'border-white scale-110' : 'border-transparent hover:scale-105'}`}
                            style={{ backgroundColor: c.hex }}
                            title={c.name}
                        />
                    ))}
                </div>

                <button onClick={handleSave} className="w-full py-3 bg-insanus-red hover:bg-red-600 text-white rounded-xl font-bold text-xs uppercase shadow-neon transition">
                    Salvar Comentário
                </button>
            </div>
        </div>
    );
};

// --- EDITOR MODAL ---
interface VisualMindMapModalProps {
    rootNode: MindMapNode;
    onSave: (node: MindMapNode) => void;
    onClose: () => void;
    title?: string;
    enableImages?: boolean; // NEW: Control for admin feature
}

export const VisualMindMapModal: React.FC<VisualMindMapModalProps> = ({ rootNode, onSave, onClose, title, enableImages = false }) => {
    const [tree, setTree] = useState<MindMapNode>(JSON.parse(JSON.stringify(rootNode)));
    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [startPos, setStartPos] = useState({ x: 0, y: 0 });
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [uploadingImage, setUploadingImage] = useState(false);
    
    // Post-It State
    const [showPostItModal, setShowPostItModal] = useState(false);
    const [editingComment, setEditingComment] = useState<{ nodeId: string, comment: MindMapComment } | null>(null);
    const [commentToDelete, setCommentToDelete] = useState<{ nodeId: string, commentId: string } | null>(null);
    
    // --- NEW: DELETE MODAL STATE ---
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    
    // Refs
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<HTMLDivElement>(null);
    const savedRange = useRef<Range | null>(null); // To store selection for color picker

    // Helpers to manipulate Tree
    const findNode = (root: MindMapNode, id: string): MindMapNode | null => {
        if (root.id === id) return root;
        if (root.children) {
            for (const child of root.children) {
                const found = findNode(child, id);
                if (found) return found;
            }
        }
        return null;
    };

    const updateNode = (root: MindMapNode, id: string, updates: Partial<MindMapNode>): MindMapNode => {
        if (root.id === id) return { ...root, ...updates };
        if (root.children) return { ...root, children: root.children.map(c => updateNode(c, id, updates)) };
        return root;
    };

    const addChild = (root: MindMapNode, parentId: string): MindMapNode => {
        if (root.id === parentId) {
            const newChild: MindMapNode = { id: uuid(), label: 'Novo Tópico', children: [] };
            return { ...root, children: [...(root.children || []), newChild] };
        }
        if (root.children) return { ...root, children: root.children.map(c => addChild(c, parentId)) };
        return root;
    };

    const deleteNode = (root: MindMapNode, nodeId: string): MindMapNode | null => {
        if (root.id === nodeId) return null;
        if (root.children) {
            const filtered = root.children.filter(c => c.id !== nodeId).map(c => deleteNode(c, nodeId)).filter(c => c !== null) as MindMapNode[];
            return { ...root, children: filtered };
        }
        return root;
    };

    // Helper to check if child is a descendant of parent (Cycle check)
    const isDescendant = (root: MindMapNode, parentId: string, childId: string): boolean => {
        if (parentId === childId) return true;
        const parent = findNode(root, parentId);
        if (!parent) return false;
        
        const check = (node: MindMapNode): boolean => {
            if (node.id === childId) return true;
            if (node.children) {
                return node.children.some(c => check(c));
            }
            return false;
        };
        
        return check(parent);
    };

    // Helper to attach an existing node object to a new parent
    const attachNode = (root: MindMapNode, parentId: string, nodeToAttach: MindMapNode): MindMapNode => {
        if (root.id === parentId) {
            return { ...root, children: [...(root.children || []), nodeToAttach] };
        }
        if (root.children) {
            return { ...root, children: root.children.map(c => attachNode(c, parentId, nodeToAttach)) };
        }
        return root;
    };

    // Helper to reorder nodes
    const reorderNodeInTree = (root: MindMapNode, nodeId: string, direction: 'up' | 'down'): MindMapNode => {
        if (root.children) {
            const idx = root.children.findIndex(c => c.id === nodeId);
            if (idx !== -1) {
                const newChildren = [...root.children];
                const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
                if (targetIdx >= 0 && targetIdx < newChildren.length) {
                    [newChildren[idx], newChildren[targetIdx]] = [newChildren[targetIdx], newChildren[idx]];
                    return { ...root, children: newChildren };
                }
                return root; // Boundary reached
            }
            return { ...root, children: root.children.map(c => reorderNodeInTree(c, nodeId, direction)) };
        }
        return root;
    };

    // --- COMMENT HANDLERS ---

    const handleSaveComment = (content: string, color: string) => {
        if (editingComment) {
            // EDITING EXISTING COMMENT
            const { nodeId, comment } = editingComment;
            const node = findNode(tree, nodeId);
            if (node && node.comments) {
                const updatedComments = node.comments.map(c => 
                    c.id === comment.id ? { ...c, content, backgroundColor: color } : c
                );
                setTree(prev => updateNode(prev, nodeId, { comments: updatedComments }));
            }
            setEditingComment(null);
        } else if (selectedNodeId) {
            // CREATING NEW COMMENT
            const node = findNode(tree, selectedNodeId);
            if (node) {
                const newComment: MindMapComment = {
                    id: uuid(),
                    content,
                    backgroundColor: color,
                    createdAt: new Date().toISOString()
                };
                const updatedComments = [...(node.comments || []), newComment];
                setTree(prev => updateNode(prev, selectedNodeId, { comments: updatedComments }));
            }
        }
        setShowPostItModal(false);
    };

    const handleEditComment = (nodeId: string, comment: MindMapComment) => {
        setEditingComment({ nodeId, comment });
        setShowPostItModal(true);
    };

    const initiateDeleteComment = (nodeId: string, commentId: string) => {
        setCommentToDelete({ nodeId, commentId });
    };

    const executeDeleteComment = () => {
        if (commentToDelete) {
            const { nodeId, commentId } = commentToDelete;
            const node = findNode(tree, nodeId);
            if (node && node.comments) {
                const updatedComments = node.comments.filter(c => c.id !== commentId);
                setTree(prev => updateNode(prev, nodeId, { comments: updatedComments }));
            }
            setCommentToDelete(null);
        }
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!selectedNodeId || !e.target.files || !e.target.files[0]) return;
        setUploadingImage(true);
        try {
            const file = e.target.files[0];
            const url = await uploadFileToStorage(file, 'mindmap_images');
            const newImage: MindMapImage = {
                url,
                position: 'top',
                scale: 1.0
            };
            setTree(prev => updateNode(prev, selectedNodeId, { image: newImage }));
        } catch (error) {
            alert("Erro ao enviar imagem.");
        } finally {
            setUploadingImage(false);
        }
    };

    const updateImageSettings = (position?: 'top'|'bottom'|'left'|'right', scale?: number) => {
        if (!selectedNodeId) return;
        const node = findNode(tree, selectedNodeId);
        if (node && node.image) {
            const updatedImage = { ...node.image };
            if (position) updatedImage.position = position;
            if (scale !== undefined) updatedImage.scale = scale;
            setTree(prev => updateNode(prev, selectedNodeId, { image: updatedImage }));
        }
    };

    const removeImage = () => {
        if (!selectedNodeId) return;
        setTree(prev => updateNode(prev, selectedNodeId, { image: undefined }));
    };

    const handleSelect = (id: string) => {
        // Clear range when changing selection
        savedRange.current = null;
        setSelectedNodeId(id);
        setShowEmojiPicker(false);
    };

    // --- REORDER & MOVE HANDLERS ---
    
    const handleReorder = (direction: 'up' | 'down') => {
        if (!selectedNodeId || selectedNodeId === tree.id) return;
        setTree(prev => reorderNodeInTree(prev, selectedNodeId, direction));
    };

    const handleMoveNode = (sourceId: string, targetId: string) => {
        if (sourceId === tree.id) {
            alert("Não é possível mover o nó raiz.");
            return;
        }
        if (sourceId === targetId) return; // Same node

        // Prevent Cycle: Check if target is inside source
        // Is 'targetId' a descendant of 'sourceId'?
        // We can reuse findNode on the 'sourceNode' (if we had it extracted) or generic check.
        // Actually, simple check:
        // Find source node in current tree
        const sourceNode = findNode(tree, sourceId);
        if (!sourceNode) return;

        // Check if target is a descendant of source (which would create a cycle)
        if (findNode(sourceNode, targetId)) {
            alert("Não é possível mover um tópico para dentro de si mesmo.");
            return;
        }

        // Execution:
        // 1. Delete from old location (returning new tree without source)
        const treeWithoutSource = deleteNode(tree, sourceId);
        if (!treeWithoutSource) return; // Should not happen as we checked root

        // 2. Attach sourceNode to targetId in the new tree
        const finalTree = attachNode(treeWithoutSource, targetId, sourceNode);
        setTree(finalTree);
    };

    // --- ROBUST EDITOR LOGIC ---

    // 1. Save Selection: Call this before opening any picker that steals focus
    const saveSelection = () => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            savedRange.current = sel.getRangeAt(0);
        }
    };

    // 2. Restore Selection: Call this before executing a command if focus was lost
    const restoreSelection = () => {
        const editor = editorRef.current;
        if (!editor) return;
        
        editor.focus();
        
        if (savedRange.current) {
            const sel = window.getSelection();
            if (sel) {
                sel.removeAllRanges();
                sel.addRange(savedRange.current);
            }
        }
    };

    // 3. Safe Execute Command
    const execCmd = (command: string, value: string | undefined = undefined) => {
        const editor = editorRef.current;
        if (!editor) return;

        // Ensure we are focused on the editor
        // For color pickers, we might need to restore the range first
        if (command === 'foreColor' || command === 'hiliteColor') {
            restoreSelection();
        } else {
            editor.focus();
        }

        // Execute
        document.execCommand(command, false, value);
        
        // Update State Manually
        // We do this immediately to keep React state in sync, but we DO NOT 
        // force React to re-render the innerHTML via props in useEffect.
        if (selectedNodeId) {
            const content = editor.innerHTML;
            setTree(prev => updateNode(prev, selectedNodeId, { label: content }));
        }
    };

    const insertHtml = (html: string) => {
        const editor = editorRef.current;
        if (!editor) return;

        restoreSelection(); // Ensure we insert where user left off
        editor.focus();
        document.execCommand('insertHTML', false, html);
        
        if (selectedNodeId) {
            const content = editor.innerHTML;
            setTree(prev => updateNode(prev, selectedNodeId, { label: content }));
        }
    };

    const handleColorChange = (colorVal: string) => { if (selectedNodeId) setTree(prev => updateNode(prev, selectedNodeId, { color: colorVal })); };
    const handleAddChild = () => { if (selectedNodeId) setTree(prev => addChild(prev, selectedNodeId)); };
    
    // --- FIX: SAFE DELETE HANDLERS WITH CUSTOM MODAL ---
    
    // 1. Triggered by Button: Opens the Custom Modal
    const handleDelete = (e: React.MouseEvent) => {
        e.preventDefault(); 
        e.stopPropagation(); 

        const targetId = selectedNodeId; 
        if (!targetId) return;

        if (targetId === tree.id) {
            alert("Não é possível excluir o nó raiz.");
            return;
        }
        
        // Show the custom modal instead of window.confirm
        setShowDeleteConfirm(true);
    };

    // 2. Executed by Modal Confirm Button
    const executeDelete = () => {
        if (selectedNodeId) {
            const newTree = deleteNode(tree, selectedNodeId);
            if (newTree) { 
                setTree(newTree); 
                setSelectedNodeId(null); 
            }
        }
        setShowDeleteConfirm(false);
    };

    const handleWheel = (e: React.WheelEvent) => {
        if (e.ctrlKey) {
            e.preventDefault();
            const delta = e.deltaY * -0.001;
            setScale(prev => Math.min(Math.max(.2, prev + delta), 3));
        }
    };
    
    const handleMouseDown = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('.group')) return;
        e.preventDefault(); 
        setIsDragging(true);
        setStartPos({ x: e.clientX - position.x, y: e.clientY - position.y });
        setSelectedNodeId(null);
        setShowEmojiPicker(false);
    };
    
    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging) return;
        if (e.buttons === 0) { setIsDragging(false); return; }
        e.preventDefault();
        setPosition({ x: e.clientX - startPos.x, y: e.clientY - startPos.y });
    };
    
    const handleMouseUp = () => setIsDragging(false);
    const selectedNode = selectedNodeId ? findNode(tree, selectedNodeId) : null;

    // --- CRITICAL FIX: ONE-WAY SYNC ON MOUNT ONLY ---
    // This useEffect only runs when the selectedNodeId changes.
    // It initializes the editor content.
    // It DOES NOT run when tree changes (typing), preventing the crash loop.
    useEffect(() => {
        if (selectedNodeId && editorRef.current) {
            const node = findNode(tree, selectedNodeId);
            if (node) {
                editorRef.current.innerHTML = node.label || "";
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedNodeId]); 
    // ^ Dependency is ONLY selectedNodeId. Not 'tree', not 'node.label'.

    return createPortal(
        <div className="fixed inset-0 z-[9999] bg-[#050505] flex flex-col animate-fade-in overflow-hidden select-none">
            {showPostItModal && (
                <PostItModal 
                    onSave={handleSaveComment} 
                    onClose={() => { setShowPostItModal(false); setEditingComment(null); }} 
                    initialContent={editingComment?.comment.content}
                    initialColor={editingComment?.comment.backgroundColor}
                />
            )}

            {/* DELETE CONFIRMATION POPUP (TOPIC) */}
            {showDeleteConfirm && (
                <div 
                    className="fixed inset-0 z-[100001] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="bg-[#1A1A1A] border border-red-500/30 p-6 rounded-2xl shadow-2xl max-sm w-full relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-red-600"></div>
                        <h3 className="text-lg font-bold text-white mb-3 uppercase flex items-center gap-2">
                            <Icon.Trash className="w-5 h-5 text-red-500"/> Excluir Tópico?
                        </h3>
                        <p className="text-gray-400 text-xs mb-6 leading-relaxed">
                            Você está prestes a excluir este tópico e <strong>todas as suas ramificações</strong>. <br/>Esta ação é irreversível.
                        </p>
                        <div className="flex gap-3">
                            <button 
                                onClick={() => setShowDeleteConfirm(false)}
                                className="flex-1 bg-transparent border border-white/10 hover:bg-white/5 text-gray-300 py-3 rounded-xl font-bold text-[10px] uppercase transition"
                            >
                                Cancelar
                            </button>
                            <button 
                                onClick={executeDelete}
                                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-bold text-[10px] uppercase shadow-neon transition"
                            >
                                Confirmar Exclusão
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* DELETE CONFIRMATION POPUP (COMMENT/POST-IT) */}
            {commentToDelete && (
                <div 
                    className="fixed inset-0 z-[100001] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="bg-[#1A1A1A] border border-red-500/30 p-6 rounded-2xl shadow-2xl max-sm w-full relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-red-600"></div>
                        <h3 className="text-lg font-bold text-white mb-3 uppercase flex items-center gap-2">
                            <Icon.Trash className="w-5 h-5 text-red-500"/> Excluir Anotação?
                        </h3>
                        <p className="text-gray-400 text-xs mb-6 leading-relaxed">
                            Deseja realmente remover este Post-it? <br/>Esta ação é irreversível.
                        </p>
                        <div className="flex gap-3">
                            <button 
                                onClick={() => setCommentToDelete(null)}
                                className="flex-1 bg-transparent border border-white/10 hover:bg-white/5 text-gray-300 py-3 rounded-xl font-bold text-[10px] uppercase transition"
                            >
                                Cancelar
                            </button>
                            <button 
                                onClick={executeDeleteComment}
                                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-bold text-[10px] uppercase shadow-neon transition"
                            >
                                Excluir
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {title && (
                <div className="absolute top-6 left-1/2 -translate-x-1/2 z-40 bg-black/50 border border-white/10 px-4 py-2 rounded-lg backdrop-blur text-white font-bold uppercase tracking-widest text-sm shadow-xl">
                    {title}
                </div>
            )}
            
            <div className="absolute top-6 left-6 z-40 pointer-events-none">
                <div className="text-[10px] text-gray-500 font-mono bg-black/50 px-3 py-1 rounded border border-white/5 backdrop-blur-sm">
                    Clique para editar • Arraste para mover • Ctrl+Scroll para Zoom
                </div>
            </div>

            {selectedNode && (
                <div 
                    className="absolute top-20 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 animate-slide-up"
                    onMouseDown={(e) => e.stopPropagation()} 
                >
                    <div className="bg-[#1A1A1A] border border-white/20 p-4 rounded-xl shadow-2xl flex flex-col gap-3 min-w-[340px] relative">
                        {/* Header */}
                        <div className="flex justify-between items-center border-b border-white/10 pb-2">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Editar Tópico</span>
                            <div className="flex items-center gap-2">
                                <div className="flex items-center bg-white/5 rounded border border-white/5">
                                    <button onClick={() => handleReorder('up')} className="p-1 text-gray-400 hover:text-white transition" title="Mover para Cima"><Icon.ArrowUp className="w-4 h-4"/></button>
                                    <div className="w-px h-4 bg-white/10"></div>
                                    <button onClick={() => handleReorder('down')} className="p-1 text-gray-400 hover:text-white transition" title="Mover para Baixo"><Icon.ArrowDown className="w-4 h-4"/></button>
                                </div>
                                <button onClick={() => setSelectedNodeId(null)} className="text-gray-500 hover:text-white ml-2"><Icon.ChevronDown className="w-4 h-4"/></button>
                            </div>
                        </div>

                        {/* Rich Text Toolbar */}
                        <div className="flex flex-wrap gap-1 border-b border-white/10 pb-2">
                            {[
                                { cmd: 'bold', label: 'B', style: 'font-bold' },
                                { cmd: 'italic', label: 'I', style: 'italic' },
                                { cmd: 'underline', label: 'U', style: 'underline' },
                                { cmd: 'strikeThrough', label: 'S', style: 'line-through' },
                            ].map(btn => (
                                <button 
                                    key={btn.cmd} 
                                    onMouseDown={(e) => { e.preventDefault(); execCmd(btn.cmd); }} 
                                    className={`w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 text-gray-300 text-xs ${btn.style}`}
                                >
                                    {btn.label}
                                </button>
                            ))}
                            <div className="w-px h-4 bg-white/10 mx-1 self-center"></div>
                            
                            {/* Text Color */}
                            <div className="relative group/color w-6 h-6">
                                <button 
                                    onMouseDown={(e) => e.preventDefault()} // Prevent blur
                                    className="w-full h-full flex items-center justify-center rounded hover:bg-white/10 text-gray-300 font-serif font-bold text-xs" 
                                    title="Cor do Texto"
                                >
                                    <span style={{ borderBottom: '2px solid currentColor' }}>A</span>
                                </button>
                                <input 
                                    type="color" 
                                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                    onClick={() => saveSelection()} // Save before dialog opens
                                    onChange={(e) => { execCmd('foreColor', e.target.value); }}
                                />
                            </div>

                            {/* Highlight */}
                            <div className="relative group/highlight w-6 h-6">
                                <button 
                                    onMouseDown={(e) => e.preventDefault()} // Prevent blur
                                    className="w-full h-full flex items-center justify-center rounded hover:bg-white/10 text-gray-300 text-xs" 
                                    title="Marca Texto"
                                >
                                    <Icon.Edit className="w-3 h-3 text-yellow-500 fill-current"/>
                                </button>
                                <input 
                                    type="color" 
                                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                    onClick={() => saveSelection()} // Save before dialog opens
                                    onChange={(e) => { execCmd('hiliteColor', e.target.value); }}
                                />
                            </div>

                            <div className="w-px h-4 bg-white/10 mx-1 self-center"></div>

                            {/* Emoji Toggle */}
                            <button 
                                onMouseDown={(e) => { 
                                    e.preventDefault(); 
                                    saveSelection(); // Save range before opening emoji picker
                                    setShowEmojiPicker(!showEmojiPicker); 
                                }} 
                                className={`w-6 h-6 flex items-center justify-center rounded text-gray-300 text-xs transition ${showEmojiPicker ? 'bg-white/20 text-white' : 'hover:bg-white/10'}`} 
                                title="Símbolos"
                            >
                                😊
                            </button>
                        </div>

                        {/* Emoji Picker */}
                        {showEmojiPicker && (
                            <div className="grid grid-cols-5 gap-1 bg-[#0F0F0F] p-2 rounded border border-white/10 absolute top-[90px] right-4 z-50 shadow-xl">
                                {EMOJI_LIST.map(em => (
                                    <button 
                                        key={em} 
                                        onMouseDown={(e) => { 
                                            e.preventDefault(); 
                                            insertHtml(em); 
                                        }} 
                                        className="w-8 h-8 flex items-center justify-center hover:bg-white/10 rounded text-lg transition"
                                    >
                                        {em}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Editor Input - Controlled Unidirectional */}
                        <div 
                            ref={editorRef}
                            contentEditable
                            onBlur={saveSelection} // Save range when user clicks away
                            onInput={(e) => { 
                                if (selectedNodeId) {
                                    // Update state, but do NOT trigger re-render of this specific div via props
                                    const content = e.currentTarget.innerHTML;
                                    setTree(prev => updateNode(prev, selectedNodeId, { label: content })); 
                                }
                            }}
                            className="bg-black/50 border border-white/10 rounded p-2 text-white font-bold text-sm focus:border-insanus-red outline-none min-h-[40px] max-h-[150px] overflow-y-auto"
                            style={{ whiteSpace: 'pre-wrap' }} 
                        ></div>

                        {/* Node Color Picker */}
                        <div className="flex gap-2 justify-center items-center">
                            {NEON_COLORS.map(c => (
                                <button key={c.name} onClick={() => handleColorChange(c.value)} className={`w-6 h-6 rounded-full border-2 ${c.dot} ${selectedNode.color === c.value ? 'border-white scale-110' : 'border-transparent opacity-50 hover:opacity-100'} transition-all`} title={c.name}></button>
                            ))}
                            <div className="relative w-6 h-6 rounded-full overflow-hidden border border-gray-500 cursor-pointer hover:border-white transition-all group/picker" title="Nova Cor">
                                <input type="color" className="opacity-0 absolute inset-0 w-[150%] h-[150%] -top-1/4 -left-1/4 cursor-pointer p-0 m-0 z-10" onChange={(e) => handleColorChange(e.target.value)} value={selectedNode.color?.startsWith('#') ? selectedNode.color : '#ffffff'} />
                                <div className="absolute inset-0 flex items-center justify-center bg-[conic-gradient(at_center,_red,_orange,_yellow,_green,_blue,_purple,_red)] opacity-50 group-hover/picker:opacity-100 transition-opacity pointer-events-none"></div>
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><Icon.Plus className="w-3 h-3 text-white drop-shadow-md"/></div>
                            </div>
                            <button onClick={() => handleColorChange('')} className="w-6 h-6 rounded-full border border-gray-500 flex items-center justify-center text-[8px] text-gray-400 hover:text-white" title="Padrão">X</button>
                        </div>

                        {/* Image Controls (Only if enableImages is true) */}
                        {enableImages && (
                            <div className="border-t border-white/10 pt-2 space-y-2">
                                <div className="flex justify-between items-center">
                                    <span className="text-[10px] text-gray-500 font-bold uppercase">Imagem</span>
                                    {selectedNode.image ? (
                                        <button onClick={removeImage} className="text-[9px] text-red-500 hover:text-red-400 uppercase font-bold">Remover</button>
                                    ) : (
                                        <div className="relative">
                                            <input type="file" id="img-upload" className="hidden" accept="image/png, image/jpeg" onChange={handleImageUpload} disabled={uploadingImage} />
                                            <label htmlFor="img-upload" className="cursor-pointer text-[10px] bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded uppercase font-bold flex items-center gap-1">
                                                {uploadingImage ? <Icon.RefreshCw className="w-3 h-3 animate-spin"/> : <Icon.Image className="w-3 h-3"/>} Add
                                            </label>
                                        </div>
                                    )}
                                </div>
                                {selectedNode.image && (
                                    <div className="space-y-2 bg-black/40 p-2 rounded">
                                        <div className="flex gap-1 justify-between">
                                            {['top', 'bottom', 'left', 'right'].map((pos) => (
                                                <button 
                                                    key={pos}
                                                    onClick={() => updateImageSettings(pos as any)}
                                                    className={`p-1 rounded border ${selectedNode.image?.position === pos ? 'bg-insanus-red border-insanus-red text-white' : 'bg-transparent border-white/10 text-gray-500 hover:text-white'}`}
                                                    title={`Posição: ${pos}`}
                                                >
                                                    <div className={`w-3 h-3 border border-current ${pos === 'top' ? 'border-b-4' : pos === 'bottom' ? 'border-t-4' : pos === 'left' ? 'border-r-4' : 'border-l-4'}`}></div>
                                                </button>
                                            ))}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[9px] text-gray-500 font-mono">Escala:</span>
                                            <input 
                                                type="range" 
                                                min="0.5" 
                                                max="2.5" 
                                                step="0.1" 
                                                value={selectedNode.image.scale} 
                                                onChange={(e) => updateImageSettings(undefined, parseFloat(e.target.value))}
                                                className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-insanus-red"
                                            />
                                            <span className="text-[9px] text-white font-mono w-6 text-right">{selectedNode.image.scale.toFixed(1)}x</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Actions */}
                        <div className="flex gap-2 mt-1">
                            <button onClick={handleAddChild} className="flex-1 bg-blue-600/20 hover:bg-blue-600 border border-blue-500/50 text-blue-100 py-2 rounded text-[10px] font-bold uppercase transition flex items-center justify-center gap-1"><Icon.Plus className="w-3 h-3"/> Subtópico</button>
                            <button onClick={() => setShowPostItModal(true)} className="flex-1 bg-yellow-600/20 hover:bg-yellow-600 border border-yellow-500/50 text-yellow-100 py-2 rounded text-[10px] font-bold uppercase transition flex items-center justify-center gap-1"><Icon.FileText className="w-3 h-3"/> Post-It</button>
                            <button onClick={handleDelete} className="bg-red-600/20 hover:bg-red-600 border border-red-500/50 text-red-100 px-3 py-2 rounded text-[10px] font-bold uppercase transition flex items-center justify-center gap-1"><Icon.Trash className="w-3 h-3"/></button>
                        </div>
                    </div>
                </div>
            )}

            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 bg-[#1A1A1A]/90 backdrop-blur border border-white/10 px-6 py-3 rounded-full shadow-2xl">
                <div className="flex gap-2 items-center">
                    <button onClick={() => setScale(s => Math.max(0.2, s - 0.2))} className="p-1.5 hover:bg-white/10 rounded-full text-white transition"><Icon.ArrowDown className="w-4 h-4"/></button>
                    <span className="text-xs font-mono text-gray-400 w-12 text-center my-auto">{Math.round(scale * 100)}%</span>
                    <button onClick={() => setScale(s => Math.min(3, s + 0.2))} className="p-1.5 hover:bg-white/10 rounded-full text-white transition"><Icon.ArrowUp className="w-4 h-4"/></button>
                </div>
                <div className="h-4 w-px bg-white/20"></div>
                <button onClick={() => { setScale(1); setPosition({x:0, y:0}); }} className="text-[10px] font-bold text-gray-400 hover:text-white uppercase transition px-2">Resetar</button>
                <div className="h-4 w-px bg-white/20"></div>
                <div className="flex gap-2">
                    <button onClick={onClose} className="p-1.5 bg-red-600/20 hover:bg-red-600 border border-red-500/50 rounded-full text-white transition group" title="Sair sem Salvar"><Icon.LogOut className="w-4 h-4"/></button>
                    <button onClick={() => { onSave(tree); onClose(); }} className="p-1.5 bg-green-600/20 hover:bg-green-600 border border-green-500/50 rounded-full text-white transition group" title="Salvar Alterações"><Icon.Check className="w-4 h-4"/></button>
                </div>
            </div>

            <div 
                ref={containerRef}
                className="w-full h-full cursor-grab active:cursor-grabbing bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-[#1a1a1a] via-[#050505] to-[#000000]"
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }} 
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                <div className="absolute inset-0 pointer-events-none opacity-20" 
                     style={{ 
                         backgroundImage: 'linear-gradient(#333 1px, transparent 1px), linear-gradient(90deg, #333 1px, transparent 1px)', 
                         backgroundSize: '40px 40px',
                         transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
                         transformOrigin: '0 0'
                     }}
                ></div>

                <div 
                    className="w-full h-full flex items-center justify-center transition-transform duration-75 ease-out origin-center"
                    style={{ 
                        transform: `translate(${position.x}px, ${position.y}px) scale(${scale})` 
                    }}
                >
                    <VisualNodeRenderer 
                        node={tree} 
                        selectedId={selectedNodeId} 
                        onSelect={handleSelect} 
                        isRoot={true} 
                        onDeleteComment={initiateDeleteComment}
                        onEditComment={handleEditComment}
                        onMoveNode={handleMoveNode}
                    />
                </div>
            </div>
        </div>,
        document.body
    );
};