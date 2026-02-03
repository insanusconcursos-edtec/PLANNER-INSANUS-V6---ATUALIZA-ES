
import React, { useState, useEffect, useRef } from 'react';
import { 
    Goal, SubGoal, Flashcard, MindMapNode, SimuladoClass, Simulado, 
    User, StudyPlan, Folder, Discipline, Subject, PlanCategory, 
    SimuladoBlock, SimuladoQuestionConfig, Cycle, CycleItem,
    EditalDiscipline, EditalTopic, EditalSubTopic, GoalFile,
    GoalLink, GoalType, CategoryDefinition, CloudBackup, DatabaseBackup
} from '../types';
import { Icon } from '../components/Icons';
import { uuid } from '../constants';
import { uploadFileToStorage } from '../services/storage';
import { 
    saveSimuladoClassToDB, fetchSimuladoClassesFromDB, fetchPlansFromDB, 
    savePlanToDB, fetchUsersFromDB, saveUserToDB, deletePlanFromDB, 
    deleteUserFromDB, deleteSimuladoClassFromDB,
    createCloudSnapshot, getCloudSnapshots, deleteCloudSnapshot, restoreFromCloudSnapshot,
    exportFullDatabase, importFullDatabase,
    saveCategoryConfig, fetchCategoryConfig, createCollaborator, createAuthUser
} from '../services/db';
import { generateFlashcardsFromPDF, generateMindMapFromFiles } from '../services/ai';
import { VisualMindMapModal } from '../components/MindMapEditor';
import { auth } from '../firebase';
import { sendPasswordResetEmail } from 'firebase/auth';
import { ADMIN_EMAIL } from '../constants';

// SafeDeleteBtn Component
const SafeDeleteBtn = ({ onDelete }: { onDelete: () => void }) => {
    const [confirming, setConfirming] = useState(false);
    if (confirming) {
        return (
            <div className="flex gap-1 animate-fade-in">
                <button onClick={onDelete} className="text-[10px] font-bold text-red-500 hover:text-red-400 bg-red-900/20 px-2 rounded">CONFIRMAR</button>
                <button onClick={() => setConfirming(false)} className="text-[10px] font-bold text-gray-500 hover:text-gray-400">CANCELAR</button>
            </div>
        );
    }
    return <button onClick={() => setConfirming(true)} className="text-gray-600 hover:text-red-500 transition p-1"><Icon.Trash className="w-3.5 h-3.5"/></button>;
};

// --- SUB-COMPONENT: COLLABORATOR MODAL ---
interface CollaboratorModalProps {
    onSave: (name: string, username: string, pass: string, perms: string[]) => Promise<void>;
    onClose: () => void;
}

const CollaboratorModal: React.FC<CollaboratorModalProps> = ({ onSave, onClose }) => {
    const [name, setName] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [permissions, setPermissions] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);

    const togglePerm = (p: string) => {
        setPermissions(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name || !username || !password || permissions.length === 0) return alert("Preencha todos os campos e selecione pelo menos uma permissão.");
        if (password.length < 6) return alert("A senha deve ter no mínimo 6 caracteres.");
        
        setLoading(true);
        try {
            await onSave(name, username, password, permissions);
            onClose();
        } catch (e: any) {
            alert(e.message || "Erro ao criar colaborador.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
            <div className="bg-[#121212] border border-[#333] rounded-2xl w-full max-w-md p-6 shadow-2xl relative">
                <h3 className="text-xl font-bold text-white mb-6 uppercase flex items-center gap-2"><Icon.User className="w-5 h-5 text-blue-500"/> Novo Colaborador</h3>
                <form onSubmit={handleSave} className="space-y-4">
                    <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase">Nome Completo</label>
                        <input value={name} onChange={e => setName(e.target.value)} className="w-full bg-black/40 border border-[#333] p-2 rounded text-white text-xs outline-none focus:border-blue-500" placeholder="Ex: Maria Silva" />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase">Usuário de Acesso</label>
                        <div className="flex items-center">
                            <input value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))} className="flex-1 bg-black/40 border border-[#333] p-2 rounded-l text-white text-xs outline-none focus:border-blue-500" placeholder="mariasilva" />
                            <span className="bg-[#1A1A1A] border border-[#333] border-l-0 p-2 text-xs text-gray-500 rounded-r select-none">@staff.insanus</span>
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase">Senha Inicial</label>
                        <input type="text" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-black/40 border border-[#333] p-2 rounded text-white text-xs outline-none focus:border-blue-500" placeholder="******" />
                    </div>
                    
                    <div className="pt-2 border-t border-[#333]">
                        <label className="text-[10px] font-bold text-gray-500 uppercase block mb-2">Permissões de Acesso</label>
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 p-2 rounded bg-white/5 cursor-pointer hover:bg-white/10">
                                <input type="checkbox" checked={permissions.includes('plans_access')} onChange={() => togglePerm('plans_access')} className="accent-blue-500"/>
                                <span className="text-xs text-gray-300 font-bold uppercase">Gestão de Planos</span>
                            </label>
                            <label className="flex items-center gap-2 p-2 rounded bg-white/5 cursor-pointer hover:bg-white/10">
                                <input type="checkbox" checked={permissions.includes('users_access')} onChange={() => togglePerm('users_access')} className="accent-blue-500"/>
                                <span className="text-xs text-gray-300 font-bold uppercase">Gestão de Alunos</span>
                            </label>
                            <label className="flex items-center gap-2 p-2 rounded bg-white/5 cursor-pointer hover:bg-white/10">
                                <input type="checkbox" checked={permissions.includes('simulados_access')} onChange={() => togglePerm('simulados_access')} className="accent-blue-500"/>
                                <span className="text-xs text-gray-300 font-bold uppercase">Gestão de Simulados</span>
                            </label>
                            <label className="flex items-center gap-2 p-2 rounded bg-white/5 cursor-pointer hover:bg-white/10 border border-transparent has-[:checked]:border-blue-500/50">
                                <input type="checkbox" checked={permissions.includes('master_access')} onChange={() => togglePerm('master_access')} className="accent-blue-500"/>
                                <span className="text-xs text-blue-400 font-bold uppercase">Acesso Total (Master)</span>
                            </label>
                        </div>
                    </div>

                    <div className="flex gap-3 mt-6">
                        <button type="button" onClick={onClose} className="flex-1 bg-transparent border border-[#333] hover:border-white text-gray-400 hover:text-white py-2 rounded-lg text-xs font-bold uppercase transition">Cancelar</button>
                        <button type="submit" disabled={loading} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg text-xs font-bold uppercase shadow-neon transition disabled:opacity-50">
                            {loading ? 'Criando...' : 'Criar Acesso'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- SUB-COMPONENT: CATEGORY MANAGER MODAL ---
interface CategoryManagerModalProps {
    categories: CategoryDefinition[];
    onSave: (cats: CategoryDefinition[]) => void;
    onClose: () => void;
}

const CategoryManagerModal: React.FC<CategoryManagerModalProps> = ({ categories, onSave, onClose }) => {
    const [localCats, setLocalCats] = useState<CategoryDefinition[]>(categories);
    const [newCatName, setNewCatName] = useState('');
    const [expandedCat, setExpandedCat] = useState<string | null>(null);
    const [newSubName, setNewSubName] = useState('');

    const addCategory = () => {
        if (!newCatName.trim()) return;
        if (localCats.some(c => c.name.toLowerCase() === newCatName.toLowerCase())) return alert("Categoria já existe");
        setLocalCats([...localCats, { name: newCatName.toUpperCase(), subCategories: [] }]);
        setNewCatName('');
    };

    const removeCategory = (name: string) => {
        if (confirm("Excluir esta categoria?")) {
            setLocalCats(localCats.filter(c => c.name !== name));
        }
    };

    const addSub = (catName: string) => {
        if (!newSubName.trim()) return;
        const updated = localCats.map(c => {
            if (c.name === catName) {
                if(c.subCategories.includes(newSubName.toUpperCase())) return c;
                return { ...c, subCategories: [...c.subCategories, newSubName.toUpperCase()] };
            }
            return c;
        });
        setLocalCats(updated);
        setNewSubName('');
    };

    const removeSub = (catName: string, subName: string) => {
        const updated = localCats.map(c => {
            if (c.name === catName) {
                return { ...c, subCategories: c.subCategories.filter(s => s !== subName) };
            }
            return c;
        });
        setLocalCats(updated);
    };

    return (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
            <div className="bg-[#121212] border border-[#333] rounded-2xl w-full max-w-lg p-6 shadow-2xl relative">
                <h3 className="text-xl font-bold text-white mb-6 uppercase">Gerenciar Categorias</h3>
                <div className="flex gap-2 mb-6">
                    <input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="NOVA CATEGORIA..." className="bg-black/40 border border-[#333] p-2 rounded flex-1 text-white text-xs outline-none uppercase" />
                    <button onClick={addCategory} className="bg-insanus-red text-white px-4 rounded text-xs font-bold uppercase">Adicionar</button>
                </div>
                <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar border border border-[#333] rounded-lg p-2 bg-[#0F0F0F]">
                    {localCats.map(cat => (
                        <div key={cat.name} className="bg-[#1A1A1A] rounded border border-[#333] overflow-hidden">
                            <div className="p-3 flex justify-between items-center cursor-pointer hover:bg-white/5" onClick={() => setExpandedCat(expandedCat === cat.name ? null : cat.name)}>
                                <span className="text-sm font-bold text-white">{cat.name}</span>
                                <div className="flex gap-2">
                                    <span className="text-[10px] text-gray-500">{cat.subCategories.length} subs</span>
                                    <button onClick={(e) => { e.stopPropagation(); removeCategory(cat.name); }} className="text-red-500 hover:text-white"><Icon.Trash className="w-3 h-3"/></button>
                                </div>
                            </div>
                            {expandedCat === cat.name && (
                                <div className="p-3 bg-black/40 border-t border-[#333]">
                                    <div className="flex gap-2 mb-3">
                                        <input value={newSubName} onChange={e => setNewSubName(e.target.value)} placeholder="NOVA SUBCATEGORIA..." className="bg-black border border-[#333] p-1.5 rounded flex-1 text-gray-300 text-[10px] outline-none uppercase" onClick={e => e.stopPropagation()} />
                                        <button onClick={(e) => { e.stopPropagation(); addSub(cat.name); }} className="bg-white/10 text-white px-3 rounded text-[10px] font-bold uppercase">Add</button>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {cat.subCategories.map(sub => (
                                            <span key={sub} className="text-[9px] bg-white/5 border border-white/10 px-2 py-1 rounded text-gray-300 uppercase flex items-center gap-2">
                                                {sub} <button onClick={(e) => { e.stopPropagation(); removeSub(cat.name, sub); }} className="hover:text-red-500"><Icon.Trash className="w-2 h-2"/></button>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                <div className="flex justify-end gap-3 mt-6">
                    <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white text-xs font-bold uppercase">Cancelar</button>
                    <button onClick={() => { onSave(localCats); onClose(); }} className="bg-green-600 hover:bg-green-500 text-white px-6 py-2 rounded text-xs font-bold uppercase shadow-neon">Salvar Alterações</button>
                </div>
            </div>
        </div>
    );
};

// --- SUB-COMPONENT: MAINTENANCE & BACKUP ---
interface MaintenanceViewProps {
    currentUser: User;
}

const MaintenanceView: React.FC<MaintenanceViewProps> = ({ currentUser }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info', msg: string } | null>(null);
    const [snapshots, setSnapshots] = useState<CloudBackup[]>([]);
    const [snapshotName, setSnapshotName] = useState('');
    const [loadingSnapshots, setLoadingSnapshots] = useState(false);

    useEffect(() => { loadSnapshots(); }, []);

    const loadSnapshots = async () => {
        setLoadingSnapshots(true);
        const data = await getCloudSnapshots();
        setSnapshots(data);
        setLoadingSnapshots(false);
    }

    const handleCreateSnapshot = async () => {
        if (!snapshotName.trim()) return alert("Digite um nome para o ponto de restauração.");
        setIsLoading(true);
        setStatus({ type: 'info', msg: 'Criando snapshot na nuvem...' });
        try {
            await createCloudSnapshot(snapshotName, currentUser.email);
            setStatus({ type: 'success', msg: 'Snapshot criado com sucesso!' });
            setSnapshotName('');
            loadSnapshots();
        } catch (e) {
            setStatus({ type: 'error', msg: 'Erro ao criar snapshot.' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleRestoreSnapshot = async (backup: CloudBackup) => {
        if (confirm(`ATENÇÃO: Restaurar o ponto "${backup.label}" apagará TODOS os dados atuais e reverterá o sistema para a data ${new Date(backup.createdAt).toLocaleDateString()}. Deseja continuar?`)) {
            setIsLoading(true);
            setStatus({ type: 'info', msg: 'Restaurando snapshot da nuvem...' });
            try {
                await restoreFromCloudSnapshot(backup);
                setStatus({ type: 'success', msg: 'Sistema restaurado com sucesso! Recarregue a página.' });
            } catch (e) {
                setStatus({ type: 'error', msg: 'Erro ao restaurar snapshot.' });
            } finally {
                setIsLoading(false);
            }
        }
    }

    const handleDeleteSnapshot = async (id: string) => {
        if(confirm("Excluir este backup permanentemente?")) {
            await deleteCloudSnapshot(id);
            loadSnapshots();
        }
    }

    const handleExport = async () => {
        setIsLoading(true);
        setStatus({ type: 'info', msg: 'Gerando arquivo local...' });
        try {
            const data = await exportFullDatabase();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `INSANUS_BACKUP_${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            setStatus({ type: 'success', msg: 'Arquivo JSON exportado!' });
        } catch (e) {
            setStatus({ type: 'error', msg: 'Erro ao exportar dados.' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (evt) => {
            const content = evt.target?.result as string;
            try {
                const backup = JSON.parse(content) as DatabaseBackup;
                if (!backup.users || !backup.plans) throw new Error('Formato inválido');
                if (confirm('ATENÇÃO: Isso apagará TODOS os dados atuais e restaurará o ponto selecionado. Deseja prosseguir?')) {
                    setIsLoading(true);
                    setStatus({ type: 'info', msg: 'Restaurando sistema... Por favor, não feche a aba.' });
                    await importFullDatabase(backup);
                    setStatus({ type: 'success', msg: 'Sistema restaurado com sucesso! Recarregue a página.' });
                }
            } catch (err) {
                alert('O arquivo selecionado não é um backup válido do Insanus Planner.');
            } finally {
                setIsLoading(false);
            }
        };
        reader.readAsText(file);
    };

    return (
        <div className="w-full max-w-5xl mx-auto space-y-8 animate-fade-in p-6">
            <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 bg-insanus-red/10 rounded-full flex items-center justify-center border border-insanus-red/30"><Icon.RefreshCw className="w-6 h-6 text-insanus-red"/></div>
                <div><h2 className="text-3xl font-black text-white uppercase tracking-tight">Manutenção & Backup</h2><p className="text-gray-400">Gerencie a integridade dos dados e crie pontos de restauração.</p></div>
            </div>
            {status && (
                <div className={`p-4 rounded-xl border animate-fade-in flex items-center gap-3 ${status.type === 'success' ? 'bg-green-900/10 border-green-500/30 text-green-400' : status.type === 'error' ? 'bg-red-900/10 border-red-500/30 text-red-400' : 'bg-blue-900/10 border-blue-500/30 text-blue-400'}`}>
                    {status.type === 'success' ? <Icon.Check className="w-5 h-5 shrink-0"/> : <Icon.RefreshCw className="w-5 h-5 shrink-0 animate-spin"/>}
                    <span className="text-sm font-bold uppercase">{status.msg}</span>
                    {status.type === 'success' && <button onClick={() => window.location.reload()} className="ml-auto underline">Recarregar Sistema</button>}
                </div>
            )}
            <div className="bg-[#121212] border border-blue-500/20 p-6 rounded-2xl shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 relative z-10">
                    <div><h3 className="text-xl font-bold text-white uppercase flex items-center gap-2"><Icon.RefreshCw className="w-5 h-5 text-blue-500"/> Snapshots na Nuvem</h3><p className="text-xs text-gray-500">Pontos de restauração salvos diretamente no servidor.</p></div>
                    <div className="flex gap-2 w-full md:w-auto"><input value={snapshotName} onChange={e => setSnapshotName(e.target.value)} placeholder="Nome do Ponto" className="bg-[#050505] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:border-blue-500 outline-none flex-1 min-w-[200px]" /><button onClick={handleCreateSnapshot} disabled={isLoading} className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 py-2 rounded-lg text-xs uppercase shadow-neon transition whitespace-nowrap disabled:opacity-50">{isLoading ? 'Criando...' : '+ Criar Snapshot'}</button></div>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar bg-[#050505] rounded-xl border border-[#333] p-2">
                    {loadingSnapshots ? (<div className="text-center py-4 text-gray-500 text-xs">Carregando snapshots...</div>) : snapshots.length === 0 ? (<div className="text-center py-8 text-gray-600 italic text-xs">Nenhum snapshot encontrado.</div>) : (snapshots.map(snap => (
                        <div key={snap.id} className="flex items-center justify-between p-3 rounded-lg bg-[#121212] border border-[#333] hover:border-blue-500/30 transition group">
                            <div className="flex items-center gap-3"><div className="w-2 h-2 rounded-full bg-blue-500"></div><div><h4 className="font-bold text-white text-sm">{snap.label}</h4><p className="text-[10px] text-gray-500 font-mono">{new Date(snap.createdAt).toLocaleString()}</p></div></div>
                            <div className="flex gap-2 opacity-60 group-hover:opacity-100 transition"><button onClick={() => handleRestoreSnapshot(snap)} disabled={isLoading} className="px-3 py-1.5 bg-yellow-600/20 text-yellow-500 border border-yellow-600/30 rounded text-[10px] font-bold uppercase hover:bg-yellow-600 hover:text-white transition">Restaurar</button><button onClick={() => handleDeleteSnapshot(snap.id)} className="p-1.5 text-red-500 hover:text-red-400 transition" title="Excluir"><Icon.Trash className="w-4 h-4"/></button></div>
                        </div>
                    )))}
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
                <div className="bg-[#121212] border border-[#333] p-6 rounded-2xl flex flex-col justify-between hover:border-white/10 transition shadow-lg">
                    <div><h3 className="text-lg font-bold text-white mb-2 uppercase flex items-center gap-2"><Icon.Download className="w-4 h-4"/> Backup Local (JSON)</h3><p className="text-[10px] text-gray-500 mb-4">Baixe um arquivo JSON com todos os dados.</p></div>
                    <button onClick={handleExport} disabled={isLoading} className="w-full bg-white/5 hover:bg-white/10 text-gray-300 font-bold py-3 rounded-xl border border-white/10 hover:border-white/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 text-xs uppercase">{isLoading ? <Icon.RefreshCw className="w-4 h-4 animate-spin"/> : <Icon.Download className="w-4 h-4"/>} Baixar JSON</button>
                </div>
                <div className="bg-[#121212] border border-[#333] p-6 rounded-2xl flex flex-col justify-between hover:border-white/10 transition shadow-lg relative overflow-hidden group">
                    <div><h3 className="text-lg font-bold text-white mb-2 uppercase flex items-center gap-2"><Icon.Upload className="w-4 h-4"/> Restaurar Local</h3><p className="text-[10px] text-gray-500 mb-4">Carregue um arquivo JSON do computador.</p></div>
                    <div className="relative"><input type="file" accept=".json" onChange={handleImport} disabled={isLoading} className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"/><button disabled={isLoading} className="w-full bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 text-xs uppercase">{isLoading ? <Icon.RefreshCw className="w-4 h-4 animate-spin"/> : <Icon.Upload className="w-4 h-4"/>} Selecionar Arquivo</button></div>
                </div>
            </div>
        </div>
    );
};

// --- HELPER COMPONENTS ---

// Helper for dates in User Management
const getDaysDiff = (dateStr?: string) => {
    if (!dateStr) return 0;
    const diff = new Date(dateStr).getTime() - new Date().getTime();
    return Math.ceil(diff / (1000 * 3600 * 24));
};

// LinkSelector Component
interface LinkSelectorProps {
    plan: StudyPlan;
    value?: string;
    onChange: (val: string) => void;
}
const LinkSelector: React.FC<LinkSelectorProps> = ({ plan, value, onChange }) => {
    const options: { id: string; label: string }[] = [];
    plan.disciplines.forEach(d => { d.subjects.forEach(s => { s.goals.forEach(g => { options.push({ id: g.id, label: `${d.name} > ${s.name} > ${g.title}` }); }); }); });
    return (
        <select value={value || ''} onChange={e => onChange(e.target.value)} className="bg-black/40 border border-white/10 text-[10px] text-gray-300 rounded p-1 max-w-[150px] outline-none focus:border-insanus-red truncate">
            <option value="">-- Selecionar --</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
    );
};

// EditalSubTopicEditor
interface EditalSubTopicEditorProps {
    sub: EditalSubTopic;
    plan: StudyPlan;
    onUpdate: (s: EditalSubTopic) => void;
    onDelete: () => void;
    onMove: (dir: 'up' | 'down') => void;
    isFirst: boolean;
    isLast: boolean;
}
const EditalSubTopicEditor: React.FC<EditalSubTopicEditorProps> = ({ sub, plan, onUpdate, onDelete, onMove, isFirst, isLast }) => {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="ml-6 border-l border-[#333] pl-2 mt-2">
            <div className="flex items-center gap-2 mb-2">
                <button onClick={() => setExpanded(!expanded)} className="text-gray-500 hover:text-white mr-1">
                    <Icon.ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`}/>
                </button>
                <input value={sub.name} onChange={e => onUpdate({...sub, name: e.target.value})} className="bg-transparent text-xs text-gray-400 focus:text-white border-b border-transparent focus:border-white/20 outline-none w-full" placeholder="Nome do Subtópico"/>
                <div className="flex items-center gap-1">
                    <button onClick={() => onMove('up')} disabled={isFirst} className="text-gray-600 hover:text-white disabled:opacity-20"><Icon.ArrowUp className="w-3 h-3"/></button>
                    <button onClick={() => onMove('down')} disabled={isLast} className="text-gray-600 hover:text-white disabled:opacity-20"><Icon.ArrowDown className="w-3 h-3"/></button>
                </div>
                <button onClick={onDelete} className="text-gray-600 hover:text-red-500 ml-1"><Icon.Trash className="w-3 h-3"/></button>
            </div>
            {expanded && (
                <div className="grid grid-cols-2 gap-2 animate-fade-in">
                    {['aula','material','questoes','leiSeca','resumo','revisao'].map(key => (
                        <div key={key} className="flex flex-col">
                            <label className="text-[8px] text-gray-600 uppercase font-bold">{key}</label>
                            <LinkSelector plan={plan} value={sub.links[key as keyof typeof sub.links]} onChange={v => onUpdate({...sub, links: {...sub.links, [key]: v}})} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// EditalTopicEditor
interface EditalTopicEditorProps {
    topic: EditalTopic;
    plan: StudyPlan;
    onUpdate: (t: EditalTopic) => void;
    onDelete: () => void;
    onMove: (dir: 'up' | 'down') => void;
    isFirst: boolean;
    isLast: boolean;
}
const EditalTopicEditor: React.FC<EditalTopicEditorProps> = ({ topic, plan, onUpdate, onDelete, onMove, isFirst, isLast }) => {
    const [expanded, setExpanded] = useState(false);
    
    const moveSubTopic = (index: number, dir: 'up' | 'down') => {
        const subs = [...(topic.subTopics || [])];
        const targetIndex = dir === 'up' ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= subs.length) return;
        [subs[index], subs[targetIndex]] = [subs[targetIndex], subs[index]];
        onUpdate({ ...topic, subTopics: subs });
    };

    return (
        <div className="bg-[#1A1A1A] p-3 rounded border border-[#333] mb-2">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1">
                    <button onClick={() => setExpanded(!expanded)}><Icon.ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}/></button>
                    <input value={topic.name} onChange={e => onUpdate({...topic, name: e.target.value})} className="bg-transparent text-sm font-bold text-white outline-none w-full" placeholder="Nome do Tópico"/>
                </div>
                <div className="flex items-center gap-1">
                    <button onClick={() => onMove('up')} disabled={isFirst} className="text-gray-600 hover:text-white disabled:opacity-20"><Icon.ArrowUp className="w-3 h-3"/></button>
                    <button onClick={() => onMove('down')} disabled={isLast} className="text-gray-600 hover:text-white disabled:opacity-20"><Icon.ArrowDown className="w-3 h-3"/></button>
                    <button onClick={onDelete} className="text-gray-600 hover:text-red-500 ml-2"><Icon.Trash className="w-3 h-3"/></button>
                </div>
            </div>
            {expanded && (
                <div className="mt-4 pt-4 border-t border-[#333] animate-fade-in">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                        {['aula','material','questoes','leiSeca','resumo','revisao'].map(key => (
                            <div key={key} className="flex flex-col">
                                <label className="text-[8px] text-gray-500 uppercase font-bold mb-1">{key}</label>
                                <LinkSelector plan={plan} value={topic.links[key as keyof typeof topic.links]} onChange={v => onUpdate({...topic, links: {...topic.links, [key]: v}})} />
                            </div>
                        ))}
                    </div>
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] font-bold text-gray-500 uppercase">Subtópicos</span>
                            <button onClick={() => onUpdate({...topic, subTopics: [...(topic.subTopics || []), {id: uuid(), name: 'Novo Sub', links: {}, order: 0}]})} className="text-[10px] text-insanus-red hover:text-white font-bold uppercase">+ Add Sub</button>
                        </div>
                        {topic.subTopics?.map((sub, idx) => (
                            <EditalSubTopicEditor 
                                key={sub.id} 
                                sub={sub} 
                                plan={plan} 
                                onUpdate={s => { const ns = [...(topic.subTopics || [])]; ns[idx] = s; onUpdate({...topic, subTopics: ns}); }} 
                                onDelete={() => { const ns = [...(topic.subTopics || [])]; ns.splice(idx, 1); onUpdate({...topic, subTopics: ns}); }} 
                                onMove={(dir) => moveSubTopic(idx, dir)}
                                isFirst={idx === 0}
                                isLast={idx === (topic.subTopics?.length || 0) - 1}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

// CycleEditor
interface CycleEditorProps {
    cycle: Cycle;
    allDisciplines: Discipline[];
    allFolders: Folder[];
    linkedSimulados: SimuladoClass[];
    onUpdate: (c: Cycle) => void;
    onDelete: () => void;
}
const CycleEditor: React.FC<CycleEditorProps> = ({ cycle, allDisciplines, allFolders, linkedSimulados, onUpdate, onDelete }) => {
    const [expanded, setExpanded] = useState(false);
    const addItem = (type: 'DISC' | 'FOLDER' | 'SIM', id: string) => {
        let newItem: CycleItem = { subjectsCount: 1 };
        if (type === 'DISC') newItem.disciplineId = id;
        if (type === 'FOLDER') newItem.folderId = id;
        if (type === 'SIM') { newItem.simuladoId = id; newItem.subjectsCount = 0; }
        onUpdate({ ...cycle, items: [...cycle.items, newItem] });
    };
    const allSimulados = linkedSimulados.flatMap(c => c.simulados);

    return (
        <div className="bg-[#121212] rounded-2xl border border-[#333] mb-4 overflow-hidden">
            <div className="p-4 bg-[#1E1E1E] flex justify-between items-center border-b border-[#333]">
                <div className="flex items-center gap-3 flex-1">
                    <button onClick={() => setExpanded(!expanded)}><Icon.ChevronDown className={`w-5 h-5 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}/></button>
                    <Icon.RefreshCw className="w-5 h-5 text-insanus-red"/>
                    <input value={cycle.name} onChange={e => onUpdate({...cycle, name: e.target.value})} className="bg-transparent font-black text-white text-lg outline-none w-full" placeholder="Nome do Ciclo"/>
                </div>
                <SafeDeleteBtn onDelete={onDelete} />
            </div>
            {expanded && (
                <div className="p-4 bg-[#121212] animate-fade-in">
                    <div className="flex flex-wrap gap-2 mb-4">
                        <select onChange={e => { if(e.target.value) addItem('FOLDER', e.target.value); e.target.value=''; }} className="bg-black/40 border border-white/10 text-xs text-gray-300 rounded p-2 outline-none"><option value="">+ Adicionar Pasta</option>{allFolders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
                        <select onChange={e => { if(e.target.value) addItem('DISC', e.target.value); e.target.value=''; }} className="bg-black/40 border border-white/10 text-xs text-gray-300 rounded p-2 outline-none"><option value="">+ Adicionar Disciplina</option>{allDisciplines.filter(d => !d.folderId).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
                        <select onChange={e => { if(e.target.value) addItem('SIM', e.target.value); e.target.value=''; }} className="bg-black/40 border border-white/10 text-xs text-gray-300 rounded p-2 outline-none"><option value="">+ Adicionar Simulado</option>{allSimulados.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select>
                    </div>
                    <div className="space-y-2">
                        {cycle.items.map((item, idx) => {
                            let label = 'Item Desconhecido';
                            if (item.folderId) label = `[PASTA] ${allFolders.find(f => f.id === item.folderId)?.name || '?'}`;
                            else if (item.disciplineId) label = `[DISC] ${allDisciplines.find(d => d.id === item.disciplineId)?.name || '?'}`;
                            else if (item.simuladoId) label = `[SIM] ${allSimulados.find(s => s.id === item.simuladoId)?.title || '?'}`;
                            return (
                                <div key={idx} className="flex items-center gap-2 bg-[#1A1A1A] p-2 rounded border border border-[#333]">
                                    <span className="text-xs text-gray-500 font-mono w-6 text-center">{idx + 1}</span>
                                    <span className="flex-1 text-sm font-bold text-gray-300">{label}</span>
                                    {!item.simuladoId && (<div className="flex items-center gap-1 bg-black p-1 rounded border border-[#333]"><span className="text-[10px] text-gray-500 uppercase">ASSUNTOS:</span><input type="number" min="1" value={item.subjectsCount} onChange={e => { const ni = [...cycle.items]; ni[idx].subjectsCount = parseInt(e.target.value)||1; onUpdate({...cycle, items: ni}); }} className="w-10 bg-transparent text-center text-white font-bold text-xs outline-none"/></div>)}
                                    <div className="flex gap-1">
                                         <button onClick={() => { if(idx > 0) { const ni = [...cycle.items]; [ni[idx], ni[idx-1]] = [ni[idx-1], ni[idx]]; onUpdate({...cycle, items: ni}); } }} className="p-1 hover:text-white text-gray-600"><Icon.ArrowUp className="w-3 h-3"/></button>
                                         <button onClick={() => { if(idx < cycle.items.length-1) { const ni = [...cycle.items]; [ni[idx], ni[idx+1]] = [ni[idx+1], ni[idx]]; onUpdate({...cycle, items: ni}); } }} className="p-1 hover:text-white text-gray-600"><Icon.ArrowDown className="w-3 h-3"/></button>
                                         <button onClick={() => { const ni = [...cycle.items]; ni.splice(idx, 1); onUpdate({...cycle, items: ni}); }} className="p-1 hover:text-red-500 text-gray-600"><Icon.Trash className="w-3 h-3"/></button>
                                    </div>
                                </div>
                            );
                        })}
                        {cycle.items.length === 0 && <div className="text-center text-gray-600 text-xs italic py-4">Nenhum item no ciclo.</div>}
                    </div>
                </div>
            )}
        </div>
    );
};

// GoalEditor Component
interface GoalEditorProps {
    goal: Goal;
    onUpdate: (g: Goal) => void;
    onDelete: () => void;
    onMove: (dir: 'up' | 'down') => void;
    isFirst: boolean;
    isLast: boolean;
}

const GoalEditor: React.FC<GoalEditorProps> = ({ goal, onUpdate, onDelete, onMove, isFirst, isLast }) => {
    const [uploading, setUploading] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [generatingFlashcards, setGeneratingFlashcards] = useState(false);
    const [generatingMindMap, setGeneratingMindMap] = useState(false);
    const [openVisualEditor, setOpenVisualEditor] = useState(false);
    
    // NEW: States for Multi-Link
    const [newLinkName, setNewLinkName] = useState('');
    const [newLinkUrl, setNewLinkUrl] = useState('');

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || !e.target.files[0]) return;
        setUploading(true);
        const file = e.target.files[0];
        try {
            const url = await uploadFileToStorage(file);
            const currentUrls = goal.pdfUrls || [];
            onUpdate({ ...goal, pdfUrls: [...currentUrls, { name: file.name, url }] });
        } catch (err) { alert("Erro no upload"); } 
        finally { setUploading(false); }
    };

    // NEW: Link Handlers
    const addLink = () => {
        if (!newLinkName.trim() || !newLinkUrl.trim()) return alert("Preencha nome e URL.");
        const currentLinks = goal.links || [];
        onUpdate({ ...goal, links: [...currentLinks, { name: newLinkName, url: newLinkUrl }] });
        setNewLinkName('');
        setNewLinkUrl('');
    }

    const removeLink = (index: number) => {
        const newLinks = (goal.links || []).filter((_, i) => i !== index);
        onUpdate({ ...goal, links: newLinks });
    }

    const addSubGoal = () => { onUpdate({ ...goal, subGoals: [...(goal.subGoals || []), { id: uuid(), title: 'Nova Aula', link: '', duration: 30 }] }); };
    const updateSubGoal = (index: number, field: keyof SubGoal, value: any) => { if (!goal.subGoals) return; const newSubs = [...goal.subGoals]; newSubs[index] = { ...newSubs[index], [field]: value }; onUpdate({ ...goal, subGoals: newSubs }); };
    const removeSubGoal = (index: number) => { if (!goal.subGoals) return; const newSubs = goal.subGoals.filter((_, i) => i !== index); onUpdate({ ...goal, subGoals: newSubs }); };
    
    const handleGenerateFlashcards = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || !e.target.files[0]) return;
        setGeneratingFlashcards(true);
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = async (evt) => {
            const base64 = evt.target?.result as string;
            if (!base64) { alert("Erro ao ler arquivo."); setGeneratingFlashcards(false); return; }
            try {
                const newCards = await generateFlashcardsFromPDF(base64);
                onUpdate({ ...goal, flashcards: [...(goal.flashcards || []), ...newCards] });
                alert(`${newCards.length} flashcards gerados com sucesso!`);
            } catch (error: any) { alert(error.message || "Erro na geração de flashcards."); } finally { setGeneratingFlashcards(false); }
        };
        reader.readAsDataURL(file);
    };

    // NEW: Handle Mind Map Generation with Robust Checks
    const handleGenerateMindMap = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || !e.target.files.length) return;
        
        // 1. File Size Check (Prevent browser freeze)
        const MAX_SIZE = 10 * 1024 * 1024; // 10MB
        const files = Array.from(e.target.files) as File[];
        for (const f of files) {
            if (f.size > MAX_SIZE) {
                alert(`O arquivo "${f.name}" é muito grande (>10MB). Por favor, use arquivos menores para evitar travamentos.`);
                return;
            }
        }

        setGeneratingMindMap(true);
        
        try {
            // 2. Upload files to Storage FIRST (Persist reference)
            const uploadedSources: GoalFile[] = [];
            for (const file of files) {
                try {
                    const url = await uploadFileToStorage(file, 'mindmap_sources');
                    uploadedSources.push({ name: file.name, url });
                } catch (err) {
                    throw new Error(`Falha ao enviar arquivo "${file.name}" para o servidor.`);
                }
            }

            // 3. Convert to Base64 for AI Processing
            const filePromises = files.map(file => new Promise<{ base64: string, mimeType: string, file: File }>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve({
                    base64: reader.result as string,
                    mimeType: file.type || 'application/pdf', 
                    file: file
                });
                reader.onerror = reject;
                reader.readAsDataURL(file);
            }));

            const fileData = await Promise.all(filePromises);

            // 4. Generate Map with AI
            const mapRoot = await generateMindMapFromFiles(fileData.map(d => ({ base64: d.base64, mimeType: d.mimeType })));
            
            // 5. Update Goal
            onUpdate({ 
                ...goal, 
                mindMapSourcePdfs: [...(goal.mindMapSourcePdfs || []), ...uploadedSources],
                generatedMindMap: mapRoot 
            });

            alert("Mapa Mental gerado com sucesso!");
        } catch (error: any) {
            console.error("Erro MindMap:", error);
            alert(error.message || "Erro desconhecido ao gerar mapa mental.");
        } finally {
            setGeneratingMindMap(false);
        }
    };

    const addManualFlashcard = () => { onUpdate({ ...goal, flashcards: [...(goal.flashcards || []), { id: uuid(), question: 'Nova Pergunta', answer: 'Nova Resposta' }] }); };
    const updateFlashcard = (index: number, field: keyof Flashcard, value: string) => { if (!goal.flashcards) return; const newCards = [...goal.flashcards]; newCards[index] = { ...newCards[index], [field]: value }; onUpdate({ ...goal, flashcards: newCards }); };
    const moveFlashcard = (index: number, direction: 'up' | 'down') => { if (!goal.flashcards) return; const newCards = [...goal.flashcards]; const targetIndex = direction === 'up' ? index - 1 : index + 1; if (targetIndex < 0 || targetIndex >= newCards.length) return; [newCards[index], newCards[targetIndex]] = [newCards[targetIndex], newCards[index]]; onUpdate({ ...goal, flashcards: newCards }); };
    const removeFlashcard = (index: number) => { if (!goal.flashcards) return; const newCards = goal.flashcards.filter((_, i) => i !== index); onUpdate({ ...goal, flashcards: newCards }); };
    const totalDuration = goal.subGoals?.reduce((acc, curr) => acc + (Number(curr.duration)||0), 0) || 0;

    return (
        <div className="bg-[#1E1E1E] p-3 rounded border border-[#333] hover:border-white/20 transition-all mb-2 w-full">
            {openVisualEditor && goal.generatedMindMap && (
                <VisualMindMapModal 
                    rootNode={goal.generatedMindMap} 
                    onSave={(newRoot) => onUpdate({ ...goal, generatedMindMap: newRoot })}
                    onClose={() => setOpenVisualEditor(false)}
                    enableImages={true} // Allow Admin to add images to the template
                />
            )}
            
            <div className="flex items-center gap-2 mb-2">
                <div className="w-3 h-8 rounded shrink-0 cursor-pointer border border-white/10" style={{ backgroundColor: goal.color || '#333' }}><input type="color" className="opacity-0 w-full h-full cursor-pointer" value={goal.color || '#333333'} onChange={(e) => onUpdate({...goal, color: e.target.value})} /></div>
                <select value={goal.type} onChange={e => onUpdate({...goal, type: e.target.value as any})} className="bg-[#121212] text-[10px] font-bold rounded p-2 text-gray-300 border-none outline-none uppercase shrink-0"><option value="AULA">AULA</option><option value="MATERIAL">PDF</option><option value="QUESTOES">QUESTÕES</option><option value="LEI_SECA">LEI SECA</option><option value="RESUMO">RESUMO</option><option value="REVISAO">REVISÃO</option></select>
                <input value={goal.title} onChange={e => onUpdate({...goal, title: e.target.value})} className="bg-transparent flex-1 text-sm font-bold text-white focus:outline-none border-b border-transparent focus:border-insanus-red placeholder-gray-600 w-full" placeholder="Título da Meta" />
                <button onClick={() => setExpanded(!expanded)} className="text-gray-500 hover:text-white shrink-0">{expanded ? <Icon.ArrowUp className="w-4 h-4" /> : <Icon.Edit className="w-4 h-4" />}</button>
                <div className="flex items-center gap-1 mx-1 border-l border-white/5 pl-2">
                    <button onClick={() => onMove('up')} disabled={isFirst} className="text-gray-500 hover:text-white disabled:opacity-20 transition p-1"><Icon.ArrowUp className="w-3.5 h-3.5" /></button>
                    <button onClick={() => onMove('down')} disabled={isLast} className="text-gray-500 hover:text-white disabled:opacity-20 transition p-1"><Icon.ArrowDown className="w-3.5 h-3.5" /></button>
                </div>
                <SafeDeleteBtn onDelete={onDelete} />
            </div>
            {expanded && (
                <div className="mt-4 pt-4 border-t border-[#333] space-y-4 animate-fade-in w-full text-gray-200">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <input value={goal.description || ''} onChange={e => onUpdate({...goal, description: e.target.value})} placeholder="Observações..." className="col-span-1 md:col-span-2 bg-[#121212] p-2 rounded text-xs text-gray-300 focus:outline-none w-full" />
                        {(goal.type === 'MATERIAL' || goal.type === 'LEI_SECA' || goal.type === 'QUESTOES') && (<div className="flex items-center gap-2 bg-[#121212] p-2 rounded w-full"><span className="text-[10px] text-gray-500 font-bold uppercase shrink-0 tracking-widest">Páginas/Qtd:</span><input type="number" value={goal.pages || 0} onChange={e => onUpdate({...goal, pages: Number(e.target.value)})} className="bg-transparent w-full text-white font-mono text-sm focus:outline-none text-right" /></div>)}
                        {(goal.type === 'RESUMO' || goal.type === 'REVISAO') && (<div className="flex items-center gap-2 bg-[#121212] p-2 rounded w-full"><span className="text-[10px] text-gray-500 font-bold uppercase shrink-0 tracking-widest">Tempo Manual (min):</span><input type="number" value={goal.manualTime || 0} onChange={e => onUpdate({...goal, manualTime: Number(e.target.value)})} className="bg-transparent w-full text-white font-mono text-sm focus:outline-none text-right" /></div>)}
                        <input value={goal.link || ''} onChange={e => onUpdate({...goal, link: e.target.value})} placeholder="Link Principal (Legado)" className="bg-[#121212] p-2 rounded text-xs text-gray-400 focus:text-white focus:outline-none w-full" />
                        
                        {/* MULTIPLE LINKS SECTION */}
                        <div className="col-span-1 md:col-span-2 space-y-2 border-t border-[#333] pt-4">
                            <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest flex items-center gap-2"><Icon.Link className="w-3 h-3"/> Links de Apoio/Redirecionamento</label>
                            <div className="flex flex-col gap-2">
                                {goal.links?.map((l, i) => (
                                    <div key={i} className="flex gap-2 items-center bg-[#121212] p-2 rounded border border-[#333]">
                                        <input value={l.name} onChange={e => { const nl = [...(goal.links||[])]; nl[i].name = e.target.value; onUpdate({...goal, links: nl}); }} className="w-1/3 bg-transparent text-[10px] text-white font-bold border-b border-transparent focus:border-white/20 outline-none" placeholder="Nome Link" />
                                        <div className="h-4 w-px bg-[#333]"></div>
                                        <input value={l.url} onChange={e => { const nl = [...(goal.links||[])]; nl[i].url = e.target.value; onUpdate({...goal, links: nl}); }} className="flex-1 bg-transparent text-[10px] text-gray-400 border-b border-transparent focus:border-white/20 outline-none" placeholder="URL" />
                                        <button onClick={() => removeLink(i)} className="text-gray-600 hover:text-red-500"><Icon.Trash className="w-3 h-3"/></button>
                                    </div>
                                ))}
                                <div className="flex gap-2">
                                    <input value={newLinkName} onChange={e => setNewLinkName(e.target.value)} placeholder="Nome (Ex: Artigo Base)" className="w-1/3 bg-[#121212] p-2 rounded text-[10px] text-white border border-[#333] outline-none focus:border-insanus-red" />
                                    <input value={newLinkUrl} onChange={e => setNewLinkUrl(e.target.value)} placeholder="https://..." className="flex-1 bg-[#121212] p-2 rounded text-[10px] text-white border border-[#333] outline-none focus:border-insanus-red" />
                                    <button onClick={addLink} className="bg-insanus-red hover:bg-red-600 text-white px-3 rounded text-[10px] font-bold uppercase transition">Add</button>
                                </div>
                            </div>
                        </div>

                        <div className="col-span-1 md:col-span-2 space-y-2 border-t border-[#333] pt-4"><label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Materiais PDF</label><div className="flex flex-col gap-2">{goal.pdfUrl && (<div className="flex items-center justify-between bg-green-900/10 border border-green-900/30 p-2 rounded"><div className="flex items-center gap-2 overflow-hidden"><Icon.FileText className="w-3 h-3 text-green-500 shrink-0"/><span className="text-[10px] text-green-500 font-bold truncate">Arquivo Principal</span></div><button onClick={() => onUpdate({...goal, pdfUrl: undefined})} className="text-red-500 hover:text-red-400 transition ml-2"><Icon.Trash className="w-3 h-3"/></button></div>)}{goal.pdfUrls?.map((fileObj, idx) => (<div key={idx} className="flex items-center justify-between bg-[#121212] border border-[#333] p-2 rounded gap-2"><div className="flex items-center gap-2 flex-1 overflow-hidden"><Icon.FileText className="w-3 h-3 text-insanus-red shrink-0"/><input value={fileObj.name} onChange={(e) => { const newUrls = [...(goal.pdfUrls || [])]; newUrls[idx] = { ...newUrls[idx], name: e.target.value }; onUpdate({ ...goal, pdfUrls: newUrls }); }} className="bg-transparent text-[10px] text-gray-300 font-bold focus:outline-none border-b border-transparent focus:border-white/20 w-full" placeholder="Nome do arquivo" /></div><button onClick={() => { const newUrls = goal.pdfUrls?.filter((_, i) => i !== idx); onUpdate({...goal, pdfUrls: newUrls}); }} className="text-red-500 hover:text-red-400 transition ml-2 shrink-0"><Icon.Trash className="w-3 h-3"/></button></div>))}<div className="relative"><input type="file" id={`file-${goal.id}`} className="hidden" onChange={handleFileUpload} accept="application/pdf" /><label htmlFor={`file-${goal.id}`} className="block w-full text-center p-2 rounded cursor-pointer text-[10px] font-bold bg-[#1A1A1A] border border-dashed border-[#444] text-gray-400 hover:border-insanus-red hover:text-white transition uppercase tracking-widest">{uploading ? <Icon.RefreshCw className="w-3 h-3 animate-spin mx-auto"/> : '+ ADICIONAR NOVO PDF'}</label></div></div></div>
                        <div className="col-span-1 md:col-span-2 border-t border-[#333] pt-4 mt-2"><div className="flex items-center gap-2 mb-2"><input type="checkbox" id={`rev-${goal.id}`} checked={goal.hasRevision || false} onChange={e => onUpdate({...goal, hasRevision: e.target.checked})} className="cursor-pointer accent-insanus-red w-4 h-4" /><label htmlFor={`rev-${goal.id}`} className="text-xs font-bold text-gray-300 cursor-pointer select-none hover:text-white flex items-center gap-2 uppercase tracking-widest">ATIVAR REVISÕES AUTOMÁTICAS</label></div>{goal.hasRevision && (<div className="pl-6 space-y-2 bg-[#121212] p-3 rounded-lg border border-[#333]"><label className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Intervalos (Dias):</label><input value={goal.revisionIntervals || '1,7,15,30'} onChange={e => onUpdate({...goal, revisionIntervals: e.target.value})} placeholder="Ex: 1, 7, 15, 30" className="bg-black/30 p-2 rounded text-xs text-white focus:outline-none border border-white/10 w-full font-mono tracking-widest" /></div>)}</div>
                    </div>
                    {goal.type === 'AULA' && (<div className="bg-[#121212] p-3 rounded border border-[#333] w-full"><div className="flex justify-between items-center mb-2"><span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Aulas ({goal.subGoals?.length || 0})</span><span className="text-[10px] font-mono text-insanus-red">{totalDuration} min total</span></div><div className="space-y-2">{goal.subGoals?.map((sub, idx) => (<div key={sub.id} className="flex gap-2 items-center w-full"><span className="text-gray-600 font-mono text-xs shrink-0">{idx + 1}.</span><input value={sub.title} onChange={(e) => updateSubGoal(idx, 'title', e.target.value)} className="flex-1 bg-[#1E1E1E] p-1 px-2 rounded text-xs text-white focus:outline-none" placeholder="Título da Aula" /><input value={sub.link} onChange={(e) => updateSubGoal(idx, 'link', e.target.value)} className="w-1/4 bg-[#1E1E1E] p-1 px-2 rounded text-xs text-gray-400 focus:text-white focus:outline-none" placeholder="Link URL" /><input type="number" value={sub.duration} onChange={(e) => updateSubGoal(idx, 'duration', Number(e.target.value))} className="w-16 bg-[#1E1E1E] p-1 px-2 rounded text-xs text-white text-center focus:outline-none shrink-0" placeholder="Min" /><button onClick={() => removeSubGoal(idx)} className="text-gray-600 hover:text-red-500 shrink-0"><Icon.Trash className="w-3 h-3" /></button></div>))}</div><button onClick={addSubGoal} className="w-full mt-2 py-1 bg-[#1E1E1E] hover:bg-white/10 text-gray-400 hover:text-white text-[10px] font-bold rounded transition uppercase tracking-widest">+ ADICIONAR AULA</button></div>)}
                    
                    {/* NEW: MIND MAP GENERATOR FOR 'RESUMO' */}
                    {goal.type === 'RESUMO' && (
                        <div className="bg-[#121212] p-4 rounded-xl border border-purple-900/30 w-full relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1 h-full bg-purple-500"></div>
                            <div className="flex justify-between items-center mb-4">
                                <h4 className="text-sm font-bold text-purple-400 uppercase flex items-center gap-2">
                                    <Icon.Share2 className="w-4 h-4"/> Mapa Mental Didático (IA)
                                </h4>
                                <div className="relative flex gap-2">
                                    <input 
                                        type="file" 
                                        id={`mindmap-pdf-${goal.id}`} 
                                        className="hidden" 
                                        multiple 
                                        accept="application/pdf" 
                                        onChange={handleGenerateMindMap} 
                                        disabled={generatingMindMap} 
                                    />
                                    <label htmlFor={`mindmap-pdf-${goal.id}`} className="cursor-pointer bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase shadow-neon flex items-center gap-2 transition">
                                        {generatingMindMap ? <Icon.RefreshCw className="w-3 h-3 animate-spin"/> : <Icon.Upload className="w-3 h-3"/>}
                                        {generatingMindMap ? 'Gerando...' : 'Gerar com IA'}
                                    </label>
                                </div>
                            </div>
                            
                            {goal.mindMapSourcePdfs && goal.mindMapSourcePdfs.length > 0 && (
                                <div className="flex flex-wrap gap-2 mb-4">
                                    {goal.mindMapSourcePdfs.map((f, i) => (
                                        <span key={i} className="text-[9px] bg-purple-900/20 text-purple-300 px-2 py-1 rounded border border-purple-500/30 flex items-center gap-1">
                                            <Icon.FileText className="w-2 h-2"/> {f.name}
                                        </span>
                                    ))}
                                </div>
                            )}

                            {goal.generatedMindMap ? (
                                <div className="flex flex-col gap-3">
                                    <div className="bg-black/30 p-3 rounded-lg border border-white/5 text-xs text-gray-400 italic text-center">
                                        Mapa mental gerado. Clique abaixo para editar visualmente.
                                    </div>
                                    <button onClick={() => setOpenVisualEditor(true)} className="w-full py-3 bg-[#1A1A1A] hover:bg-[#222] border border-purple-500/30 text-purple-300 rounded-lg font-bold text-xs uppercase transition flex items-center justify-center gap-2">
                                        <Icon.Maximize className="w-4 h-4"/> Abrir Editor Visual
                                    </button>
                                </div>
                            ) : (
                                <div className="text-center py-6 border border-dashed border-[#333] rounded-lg text-gray-600 text-xs">
                                    Nenhum mapa mental gerado. Envie PDFs para criar.
                                </div>
                            )}
                        </div>
                    )}

                    {goal.type === 'REVISAO' && (<div className="bg-[#121212] p-4 rounded-xl border border-blue-900/30 w-full relative overflow-hidden"><div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div><div className="flex justify-between items-center mb-4"><h4 className="text-sm font-bold text-blue-400 uppercase flex items-center gap-2"><Icon.List className="w-4 h-4"/> Flashcards de Revisão</h4><div className="flex gap-2"><div className="relative"><input type="file" id={`flash-pdf-${goal.id}`} className="hidden" accept="application/pdf" onChange={handleGenerateFlashcards} disabled={generatingFlashcards} /><label htmlFor={`flash-pdf-${goal.id}`} className="cursor-pointer bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase shadow-neon flex items-center gap-2 transition">{generatingFlashcards ? <Icon.RefreshCw className="w-3 h-3 animate-spin"/> : <Icon.Code className="w-3 h-3"/>}{generatingFlashcards ? 'Gerando...' : 'Gerar com IA (PDF)'}</label></div><button onClick={addManualFlashcard} className="bg-[#1E1E1E] hover:bg-[#252525] text-gray-300 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase border border-white/10 transition">+ Manual</button></div></div>{(!goal.flashcards || goal.flashcards.length === 0) ? (<div className="text-center py-6 border border-dashed border-[#333] rounded-lg text-gray-600 text-xs">Nenhum flashcard criado.</div>) : (<div className="space-y-3 max-h-64 overflow-y-auto custom-scrollbar pr-2">{goal.flashcards.map((card, idx) => (<div key={card.id} className="bg-black/30 p-3 rounded border border-white/5 flex flex-col gap-2 relative group"><div className="flex justify-between"><div className="flex items-center gap-2"><span className="text-[10px] text-blue-500 font-bold uppercase">Card {idx + 1}</span><div className="flex gap-1"><button onClick={() => moveFlashcard(idx, 'up')} disabled={idx === 0} className="text-gray-500 hover:text-blue-400 disabled:opacity-10 transition-colors" title="Mover para cima"><Icon.ArrowUp className="w-3 h-3" /></button><button onClick={() => moveFlashcard(idx, 'down')} disabled={idx === goal.flashcards.length - 1} className="text-gray-500 hover:text-blue-400 disabled:opacity-10 transition-colors" title="Mover para baixo"><Icon.ArrowDown className="w-3 h-3" /></button></div></div><button onClick={() => removeFlashcard(idx)} className="text-gray-600 hover:text-red-500 transition-colors"><Icon.Trash className="w-3 h-3"/></button></div><input value={card.question} onChange={(e) => updateFlashcard(idx, 'question', e.target.value)} className="bg-[#1E1E1E] p-2 rounded text-xs text-white border border-[#333] focus:border-blue-500 outline-none placeholder-gray-600" placeholder="Pergunta..." /><textarea value={card.answer} onChange={(e) => updateFlashcard(idx, 'answer', e.target.value)} className="bg-[#1E1E1E] p-2 rounded text-xs text-gray-300 border border-[#333] focus:border-blue-500 outline-none placeholder-gray-600 resize-none h-16" placeholder="Resposta..." /></div>))}</div>)}</div>)}
                </div>
            )}
        </div>
    );
};

// UserFormModal Component
interface UserFormModalProps {
    initialUser: User | null;
    allPlans: StudyPlan[];
    allSimuladoClasses: SimuladoClass[];
    existingUsers: User[]; // New: List of all users for duplicate check
    onSave: (u: User) => Promise<void>;
    onCancel: () => void;
}
const UserFormModal: React.FC<UserFormModalProps> = ({ initialUser, allPlans, allSimuladoClasses, existingUsers, onSave, onCancel }) => {
    // Helper para calcular dias restantes
    const getDaysRemaining = (dateStr?: string) => {
        if (!dateStr) return 365; // Padrão 1 ano
        const diff = new Date(dateStr).getTime() - new Date().getTime();
        return Math.max(0, Math.ceil(diff / (1000 * 3600 * 24)));
    };

    // Helper para gerar data futura baseada em dias
    const getDateFromDays = (days: number) => {
        const d = new Date();
        d.setDate(d.getDate() + days);
        return d.toISOString();
    };

    const [formData, setFormData] = useState<User>(initialUser || {
        id: uuid(),
        name: '',
        email: '',
        cpf: '', // Inicializando CPF
        level: 'iniciante',
        isAdmin: false,
        allowedPlans: [],
        allowedSimuladoClasses: [],
        planExpirations: {},
        simuladoExpirations: {}, // Inicializando expirações de simulado
        planConfigs: {},
        routine: { days: {} },
        progress: { completedGoalIds: [], completedRevisionIds: [], totalStudySeconds: 0, planStudySeconds: {} },
        tempPassword: '', // Senha vazia inicialmente para novo cadastro
        createdAt: new Date().toISOString() // Data de cadastro
    });

    // Estados locais para dias (para edição amigável)
    const [planDays, setPlanDays] = useState<Record<string, number>>({});
    const [simDays, setSimDays] = useState<Record<string, number>>({});

    useEffect(() => {
        if (initialUser) {
            // Inicializar dias baseados nas datas salvas
            const pDays: Record<string, number> = {};
            initialUser.allowedPlans.forEach(pid => {
                pDays[pid] = getDaysRemaining(initialUser.planExpirations?.[pid]);
            });
            setPlanDays(pDays);

            const sDays: Record<string, number> = {};
            initialUser.allowedSimuladoClasses?.forEach(sid => {
                sDays[sid] = getDaysRemaining(initialUser.simuladoExpirations?.[sid]);
            });
            setSimDays(sDays);
        }
    }, [initialUser]);

    const handleSaveInternal = async (e: React.FormEvent) => {
        e.preventDefault();
        // Validações Básicas
        if (!formData.name || !formData.email || !formData.cpf) return alert("Preencha Nome, E-mail e CPF.");
        
        // --- NOVO: TRAVA DE SEGURANÇA (DUPLICIDADE) ---
        const normalizedEmail = formData.email.trim().toLowerCase();
        const duplicateEmail = existingUsers.find(u => u.email.trim().toLowerCase() === normalizedEmail && u.id !== formData.id);
        if (duplicateEmail) {
            return alert(`Este e-mail já está em uso pelo usuário: ${duplicateEmail.name}`);
        }

        const duplicateCPF = existingUsers.find(u => u.cpf.trim() === formData.cpf.trim() && u.id !== formData.id);
        if (duplicateCPF) {
            return alert(`Este CPF já está cadastrado para o usuário: ${duplicateCPF.name}`);
        }
        // ---------------------------------------------

        // Validação de senha: Apenas para NOVOS usuários
        if (!initialUser && (!formData.tempPassword || formData.tempPassword.length < 6)) {
            return alert("A senha deve ter no mínimo 6 caracteres.");
        }

        // Converter dias de volta para datas ISO
        const newPlanExpirations = { ...formData.planExpirations };
        formData.allowedPlans.forEach(pid => {
            newPlanExpirations[pid] = getDateFromDays(planDays[pid] || 365);
        });

        const newSimExpirations = { ...formData.simuladoExpirations };
        formData.allowedSimuladoClasses.forEach(sid => {
            newSimExpirations[sid] = getDateFromDays(simDays[sid] || 365);
        });

        /* INTEGRAÇÃO AUTH DIRECT */
        let finalId = formData.id;
        
        // Se for um NOVO usuário (não tem initialUser) E tem senha, criar no Authentication
        if (!initialUser && formData.tempPassword && formData.tempPassword.length >= 6) {
            try {
                // Call the new service to create user in Auth without logging admin out
                finalId = await createAuthUser(formData.email, formData.tempPassword);
            } catch (error: any) {
                console.error("Auth Error:", error);
                if (error.code === 'auth/email-already-in-use') {
                   return alert("Erro: Este e-mail já possui uma conta de acesso (Authentication).");
                }
                return alert("Erro ao criar autenticação: " + error.message);
            }
        }

        await onSave({
            ...formData,
            id: finalId, // Garante que o ID do Firestore seja o UID do Auth
            planExpirations: newPlanExpirations,
            simuladoExpirations: newSimExpirations
        });
    };

    const handleSendPasswordReset = async () => {
        if (!formData.email) return alert("É necessário um e-mail válido para enviar a redefinição.");
        try {
            await sendPasswordResetEmail(auth, formData.email);
            alert(`E-mail de redefinição de senha enviado para ${formData.email}. Peça ao aluno para verificar a caixa de entrada/spam.`);
        } catch (e: any) {
            console.error("Erro redefinição:", e);
            if (e.code === 'auth/user-not-found') {
                alert("Este usuário ainda não possui conta ativa no sistema de autenticação. Ele deve realizar o primeiro acesso com a senha temporária antiga.");
            } else {
                alert("Erro ao enviar e-mail: " + e.message);
            }
        }
    };

    const togglePlan = (id: string) => {
        const current = formData.allowedPlans || [];
        if (current.includes(id)) {
            setFormData({ ...formData, allowedPlans: current.filter(x => x !== id) });
        } else {
            setFormData({ ...formData, allowedPlans: [...current, id] });
            setPlanDays(prev => ({ ...prev, [id]: 365 })); // Default 365 dias ao adicionar
        }
    };

    const toggleSimulado = (id: string) => {
        const current = formData.allowedSimuladoClasses || [];
        if (current.includes(id)) {
            setFormData({ ...formData, allowedSimuladoClasses: current.filter(x => x !== id) });
        } else {
            setFormData({ ...formData, allowedSimuladoClasses: [...current, id] });
            setSimDays(prev => ({ ...prev, [id]: 365 })); // Default 365 dias ao adicionar
        }
    };

    // Verificação em tempo real de duplicidade
    const isEmailDuplicate = formData.email.trim().length > 0 && existingUsers.some(u => u.email.trim().toLowerCase() === formData.email.trim().toLowerCase() && u.id !== formData.id);
    const isCpfDuplicate = formData.cpf.trim().length > 0 && existingUsers.some(u => u.cpf.trim() === formData.cpf.trim() && u.id !== formData.id);

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 overflow-y-auto p-4 backdrop-blur-sm">
            <div className="bg-[#121212] p-6 rounded-xl border border-[#333] w-full max-w-2xl shadow-2xl relative animate-fade-in my-auto">
                <div className="flex justify-between items-center mb-6 border-b border-[#333] pb-4">
                    <h3 className="text-white font-bold text-xl uppercase tracking-wider">{initialUser ? 'Editar Aluno' : 'Novo Aluno'}</h3>
                    <button onClick={onCancel} className="text-gray-500 hover:text-white"><Icon.LogOut className="w-5 h-5"/></button>
                </div>
                
                <form onSubmit={handleSaveInternal} className="space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar pr-2">
                    {/* DADOS PESSOAIS */}
                    <div className="space-y-4">
                        <h4 className="text-xs font-black text-insanus-red uppercase tracking-widest flex items-center gap-2"><Icon.User className="w-4 h-4"/> Dados Pessoais</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-[10px] text-gray-500 font-bold uppercase">Nome Completo</label>
                                <input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-black/40 border border-[#333] p-2.5 rounded text-white text-xs outline-none focus:border-white/20" placeholder="Ex: João da Silva" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] text-gray-500 font-bold uppercase">E-mail</label>
                                <input value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className={`w-full bg-black/40 border p-2.5 rounded text-white text-xs outline-none transition-all ${isEmailDuplicate ? 'border-red-500 focus:border-red-500' : 'border-[#333] focus:border-white/20'}`} placeholder="Ex: joao@email.com" />
                                {isEmailDuplicate && <span className="text-[10px] text-red-500 font-bold block animate-pulse">⚠ Este e-mail já está cadastrado.</span>}
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] text-gray-500 font-bold uppercase">CPF</label>
                                <input value={formData.cpf} onChange={e => setFormData({...formData, cpf: e.target.value})} className={`w-full bg-black/40 border p-2.5 rounded text-white text-xs outline-none transition-all ${isCpfDuplicate ? 'border-red-500 focus:border-red-500' : 'border-[#333] focus:border-white/20'}`} placeholder="000.000.000-00" />
                                {isCpfDuplicate && <span className="text-[10px] text-red-500 font-bold block animate-pulse">⚠ Este CPF já está cadastrado.</span>}
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] text-gray-500 font-bold uppercase">{initialUser ? "Redefinir Senha (Via Link)" : "Senha Temporária (Min 6)"}</label>
                                {initialUser ? (
                                    <button type="button" onClick={handleSendPasswordReset} className="w-full bg-[#1A1A1A] border border-[#333] hover:border-insanus-red hover:text-white text-gray-400 p-2.5 rounded text-xs font-bold uppercase transition flex items-center justify-center gap-2">
                                        <Icon.Edit className="w-3 h-3"/> Enviar E-mail de Redefinição
                                    </button>
                                ) : (
                                    <div className="flex gap-2">
                                        <input 
                                            value={formData.tempPassword} 
                                            onChange={e => setFormData({...formData, tempPassword: e.target.value})} 
                                            className="w-full bg-black/40 border border-[#333] p-2.5 rounded text-white text-xs outline-none focus:border-insanus-red placeholder-gray-600" 
                                            placeholder="******" 
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ACESSO A PLANOS */}
                    <div className="space-y-3 pt-4 border-t border-[#333]">
                        <h4 className="text-xs font-black text-insanus-red uppercase tracking-widest flex items-center gap-2"><Icon.Book className="w-4 h-4"/> Acesso aos Planos</h4>
                        <div className="grid grid-cols-1 gap-2">
                            {allPlans.map(p => {
                                const isSelected = formData.allowedPlans.includes(p.id);
                                return (
                                    <div key={p.id} className={`flex items-center justify-between p-3 rounded border transition-all ${isSelected ? 'bg-white/5 border-insanus-red/50' : 'bg-black/20 border-[#333]'}`}>
                                        <div className="flex items-center gap-3">
                                            <input type="checkbox" checked={isSelected} onChange={() => togglePlan(p.id)} className="w-4 h-4 accent-insanus-red cursor-pointer" />
                                            <span className={`text-xs font-bold ${isSelected ? 'text-white' : 'text-gray-500'}`}>{p.name}</span>
                                        </div>
                                        {isSelected && (
                                            <div className="flex items-center gap-2 bg-black/40 px-2 py-1 rounded border border-[#333]">
                                                <span className="text-[9px] text-gray-500 font-bold uppercase">Dias:</span>
                                                <input 
                                                    type="number" 
                                                    min="1" 
                                                    value={planDays[p.id] || 365} 
                                                    onChange={(e) => setPlanDays({...planDays, [p.id]: parseInt(e.target.value)})}
                                                    className="w-12 bg-transparent text-center text-xs text-white outline-none font-mono"
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {allPlans.length === 0 && <p className="text-[10px] text-gray-600 italic">Nenhum plano cadastrado no sistema.</p>}
                        </div>
                    </div>

                    {/* ACESSO A SIMULADOS */}
                    <div className="space-y-3 pt-4 border-t border-[#333]">
                        <h4 className="text-xs font-black text-insanus-red uppercase tracking-widest flex items-center gap-2"><Icon.FileText className="w-4 h-4"/> Acesso a Turmas de Simulados</h4>
                        <div className="grid grid-cols-1 gap-2">
                            {allSimuladoClasses.map(sc => {
                                const isSelected = formData.allowedSimuladoClasses?.includes(sc.id);
                                return (
                                    <div key={sc.id} className={`flex items-center justify-between p-3 rounded border transition-all ${isSelected ? 'bg-white/5 border-blue-500/50' : 'bg-black/20 border-[#333]'}`}>
                                        <div className="flex items-center gap-3">
                                            <input type="checkbox" checked={isSelected} onChange={() => toggleSimulado(sc.id)} className="w-4 h-4 accent-blue-500 cursor-pointer" />
                                            <span className={`text-xs font-bold ${isSelected ? 'text-white' : 'text-gray-500'}`}>{sc.name}</span>
                                        </div>
                                        {isSelected && (
                                            <div className="flex items-center gap-2 bg-black/40 px-2 py-1 rounded border border-[#333]">
                                                <span className="text-[9px] text-gray-500 font-bold uppercase">Dias:</span>
                                                <input 
                                                    type="number" 
                                                    min="1" 
                                                    value={simDays[sc.id] || 365} 
                                                    onChange={(e) => setSimDays({...simDays, [sc.id]: parseInt(e.target.value)})}
                                                    className="w-12 bg-transparent text-center text-xs text-white outline-none font-mono"
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {allSimuladoClasses.length === 0 && <p className="text-[10px] text-gray-600 italic">Nenhuma turma de simulados cadastrada.</p>}
                        </div>
                    </div>

                    <div className="flex gap-3 mt-6 pt-4 border-t border-[#333]">
                        <button type="button" onClick={onCancel} className="flex-1 bg-transparent border border-[#333] hover:border-gray-500 text-gray-400 hover:text-white py-3 rounded-xl text-xs font-bold uppercase transition">CANCELAR</button>
                        <button type="submit" className="flex-1 bg-insanus-red hover:bg-red-600 text-white py-3 rounded-xl text-xs font-bold uppercase shadow-neon transition transform hover:scale-[1.02]">SALVAR USUÁRIO</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// PlanDetailEditor Component
interface PlanDetailEditorProps {
    plan: StudyPlan;
    allPlans: StudyPlan[]; // NEW: Receives all plans for migration
    categories: CategoryDefinition[]; // NEW: For dynamic dropdown
    onUpdate: (p: StudyPlan) => void;
    onBack: () => void;
    onSave?: (p: StudyPlan) => Promise<void>; 
}

const PlanDetailEditor: React.FC<PlanDetailEditorProps> = ({ plan, allPlans, categories, onUpdate, onBack, onSave }) => {
    const [tab, setTab] = useState<'struct' | 'cycles' | 'edital'>('struct');
    const [saving, setSaving] = useState(false);
    const [uploadingCover, setUploadingCover] = useState(false);
    const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
    const [editalExpandedMap, setEditalExpandedMap] = useState<Record<string, boolean>>({}); 
    const [newContestName, setNewContestName] = useState('');
    const [showSimuladoLinks, setShowSimuladoLinks] = useState(false);
    const [allSimuladoClasses, setAllSimuladoClasses] = useState<SimuladoClass[]>([]);
    
    // NEW: State for Subject Migration
    const [subjectToCopy, setSubjectToCopy] = useState<Subject | null>(null);

    useEffect(() => { const loadClasses = async () => { const classes = await fetchSimuladoClassesFromDB(); setAllSimuladoClasses(classes); }; loadClasses(); }, []);
    const toggleExpand = (id: string) => setExpandedMap(prev => ({ ...prev, [id]: !prev[id] }));
    const isExpanded = (id: string) => !!expandedMap[id];
    const toggleEditalExpand = (id: string) => setEditalExpandedMap(prev => ({ ...prev, [id]: !prev[id] }));
    const isEditalExpanded = (id: string) => !!editalExpandedMap[id];
    
    const handleSync = async () => { 
        setSaving(true); 
        try { 
            if (onSave) {
                await onSave(plan);
            } else {
                await savePlanToDB(plan); 
            }
            await new Promise(r => setTimeout(r, 800)); 
        } catch (e) { 
            alert("Erro ao salvar."); 
        } finally { 
            setSaving(false); 
        } 
    };

    const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => { if (!e.target.files || !e.target.files[0]) return; setUploadingCover(true); try { const url = await uploadFileToStorage(e.target.files[0], 'covers'); onUpdate({ ...plan, coverImage: url }); } catch (err) { alert("Erro ao enviar imagem."); } finally { setUploadingCover(false); } };
    const addContest = () => { if(!newContestName.trim()) return; const current = plan.linkedContests || []; if(current.includes(newContestName.toUpperCase())) return; onUpdate({ ...plan, linkedContests: [...current, newContestName.toUpperCase()] }); setNewContestName(''); }
    const toggleLinkedSimuladoClass = (classId: string) => { const current = plan.linkedSimuladoClasses || []; const updated = current.includes(classId) ? current.filter(id => id !== classId) : [...current, classId]; onUpdate({ ...plan, linkedSimuladoClasses: updated }); }
    const addFolder = () => { const newFolder: Folder = { id: uuid(), name: 'Nova Pasta', order: plan.folders.length }; setExpandedMap(prev => ({ ...prev, [newFolder.id]: true })); onUpdate({ ...plan, folders: [...plan.folders, newFolder] }); };
    const addDiscipline = (folderId?: string) => { const newDiscipline: Discipline = { id: uuid(), name: 'Nova Disciplina', folderId, subjects: [], order: 99 }; setExpandedMap(prev => ({ ...prev, [newDiscipline.id]: true })); onUpdate({ ...plan, disciplines: [...plan.disciplines, newDiscipline] }); };
    const addSubject = (discId: string) => { const discIndex = plan.disciplines.findIndex(d => d.id === discId); if (discIndex === -1) return; const newSub: Subject = { id: uuid(), name: 'Novo Assunto', goals: [], order: 99 }; setExpandedMap(prev => ({ ...prev, [newSub.id]: true })); const newDiscs = [...plan.disciplines]; newDiscs[discIndex].subjects.push(newSub); onUpdate({ ...plan, disciplines: newDiscs }); };
    const addGoal = (discId: string, subId: string) => { const discIndex = plan.disciplines.findIndex(d => d.id === discId); if (discIndex === -1) return; const subIndex = plan.disciplines[discIndex].subjects.findIndex(s => s.id === subId); if (subIndex === -1) return; const newGoal: Goal = { id: uuid(), title: 'Nova Meta', type: 'AULA', order: 99, link: '', pdfUrls: [], pages: 0, color: '#333333' }; const newDiscs = [...plan.disciplines]; newDiscs[discIndex].subjects[subIndex].goals.push(newGoal); onUpdate({ ...plan, disciplines: newDiscs }); };
    const moveEditalDiscipline = (index: number, direction: 'up' | 'down') => { const ne = [...(plan.editalVerticalizado || [])]; const targetIndex = direction === 'up' ? index - 1 : index + 1; if (targetIndex < 0 || targetIndex >= ne.length) return; [ne[index], ne[targetIndex]] = [ne[targetIndex], ne[index]]; onUpdate({ ...plan, editalVerticalizado: ne }); };
    const moveEditalTopic = (discIdx: number, topicIdx: number, direction: 'up' | 'down') => { const ne = [...(plan.editalVerticalizado || [])]; const topics = [...ne[discIdx].topics]; const targetIndex = direction === 'up' ? topicIdx - 1 : topicIdx + 1; if (targetIndex < 0 || targetIndex >= topics.length) return; [topics[topicIdx], topics[targetIndex]] = [topics[targetIndex], topics[topicIdx]]; ne[discIdx] = { ...ne[discIdx], topics }; onUpdate({ ...plan, editalVerticalizado: ne }); };
    
    // NEW: Handle Deep Copy Subject
    const handleCopySubject = async (targetPlanId: string, targetDiscId: string) => {
        if (!subjectToCopy) return;
        const targetPlan = allPlans.find(p => p.id === targetPlanId);
        if (!targetPlan) return;

        // Deep clone logic
        const newSubject: Subject = {
            ...subjectToCopy,
            id: uuid(),
            goals: subjectToCopy.goals.map(g => ({
                ...g,
                id: uuid(),
                subGoals: g.subGoals?.map(sg => ({...sg, id: uuid()})) || [],
                flashcards: g.flashcards?.map(f => ({...f, id: uuid()})) || [],
            }))
        };

        const updatedDiscs = targetPlan.disciplines.map(d => {
            if (d.id === targetDiscId) {
                return { ...d, subjects: [...d.subjects, newSubject] };
            }
            return d;
        });

        const updatedPlan = { ...targetPlan, disciplines: updatedDiscs };
        
        try {
            await savePlanToDB(updatedPlan);
            alert(`Assunto "${newSubject.name}" copiado com sucesso para o plano "${targetPlan.name}"!`);
            setSubjectToCopy(null);
            // If copying to current plan, update local state
            if (targetPlanId === plan.id) {
                onUpdate(updatedPlan);
            }
        } catch (e) {
            alert("Erro ao copiar assunto.");
        }
    };

    // MOVE FUNCTIONS
    const moveDiscipline = (idx: number, direction: 'up' | 'down', contextList: Discipline[]) => {
        if (direction === 'up' && idx === 0) return;
        if (direction === 'down' && idx === contextList.length - 1) return;
        
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        const discA = contextList[idx];
        const discB = contextList[targetIdx];
        
        const allDiscs = [...plan.disciplines];
        const indexA = allDiscs.findIndex(d => d.id === discA.id);
        const indexB = allDiscs.findIndex(d => d.id === discB.id);
        
        if (indexA === -1 || indexB === -1) return;
        
        [allDiscs[indexA], allDiscs[indexB]] = [allDiscs[indexB], allDiscs[indexA]];
        onUpdate({ ...plan, disciplines: allDiscs });
    };

    const moveSubject = (discId: string, subIdx: number, direction: 'up' | 'down') => {
        const discIdx = plan.disciplines.findIndex(d => d.id === discId);
        if (discIdx === -1) return;
        
        const disc = plan.disciplines[discIdx];
        const subjects = [...disc.subjects];
        
        if (direction === 'up' && subIdx === 0) return;
        if (direction === 'down' && subIdx === subjects.length - 1) return;
        
        const targetIdx = direction === 'up' ? subIdx - 1 : subIdx + 1;
        [subjects[subIdx], subjects[targetIdx]] = [subjects[targetIdx], subjects[subIdx]];
        
        const newDiscs = [...plan.disciplines];
        newDiscs[discIdx] = { ...disc, subjects };
        onUpdate({ ...plan, disciplines: newDiscs });
    };

    const moveGoal = (discId: string, subId: string, goalIdx: number, direction: 'up' | 'down') => {
        const discIdx = plan.disciplines.findIndex(d => d.id === discId);
        if (discIdx === -1) return;
        
        const disc = plan.disciplines[discIdx];
        const subIdx = disc.subjects.findIndex(s => s.id === subId);
        if (subIdx === -1) return;
        
        const sub = disc.subjects[subIdx];
        const goals = [...sub.goals];
        
        if (direction === 'up' && goalIdx === 0) return;
        if (direction === 'down' && goalIdx === goals.length - 1) return;
        
        const targetIdx = direction === 'up' ? goalIdx - 1 : goalIdx + 1;
        [goals[goalIdx], goals[targetIdx]] = [goals[targetIdx], goals[goalIdx]];
        
        const newDiscs = [...plan.disciplines];
        newDiscs[discIdx].subjects[subIdx] = { ...sub, goals };
        onUpdate({ ...plan, disciplines: newDiscs });
    };

    const renderDiscipline = (disc: Discipline, dIdx: number, contextList: Discipline[]) => (
        <div key={disc.id} className="ml-4 border-l-2 border-white/5 pl-4 mb-6">
            <div className="flex justify-between items-center mb-4 bg-[#1E1E1E] p-2 rounded-lg hover:bg-white/5 transition-all w-full border border-white/5">
                <div className="flex items-center gap-3 flex-1">
                    <button onClick={() => toggleExpand(disc.id)} className={`text-gray-400 hover:text-white transition-transform shrink-0 ${isExpanded(disc.id) ? 'rotate-180' : ''}`}>
                        <Icon.ChevronDown className="w-5 h-5" />
                    </button>
                    <div className="w-2 h-2 rounded-full bg-insanus-red shadow-neon shrink-0"></div>
                    <input value={disc.name} onChange={e => { const nd = plan.disciplines.map(d => d.id === disc.id ? {...d, name: e.target.value} : d); onUpdate({...plan, disciplines: nd}); }} className="bg-transparent font-bold text-gray-200 focus:outline-none text-base w-full" />
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <select className="bg-black text-[10px] text-gray-400 border border-white/5 rounded p-1 outline-none max-w-[120px]" value={disc.folderId || ''} onChange={(e) => { const updatedDiscs = plan.disciplines.map(d => d.id === disc.id ? { ...d, folderId: e.target.value || undefined } : d); onUpdate({ ...plan, disciplines: updatedDiscs as Discipline[] }); }}>
                        <option value="">(Sem Pasta)</option>
                        {plan.folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                    <div className="flex gap-1">
                        <button onClick={() => moveDiscipline(dIdx, 'up', contextList)} disabled={dIdx === 0} className="p-1 text-gray-500 hover:text-white disabled:opacity-20 transition"><Icon.ArrowUp className="w-4 h-4"/></button>
                        <button onClick={() => moveDiscipline(dIdx, 'down', contextList)} disabled={dIdx === contextList.length - 1} className="p-1 text-gray-500 hover:text-white disabled:opacity-20 transition"><Icon.ArrowDown className="w-4 h-4"/></button>
                    </div>
                    <button onClick={() => addSubject(disc.id)} className="text-[10px] bg-white/5 hover:bg-white/10 text-white px-3 py-1 rounded font-bold uppercase transition tracking-widest">+ ASSUNTO</button>
                    <SafeDeleteBtn onDelete={() => onUpdate({ ...plan, disciplines: plan.disciplines.filter(d => d.id !== disc.id) })} />
                </div>
            </div>
            {isExpanded(disc.id) && (
                <div className="space-y-4 pl-2 animate-fade-in w-full">
                    {disc.subjects.map((sub, sIdx) => (
                        <div key={sub.id} className="bg-[#121212] rounded-xl border border-white/5 p-4 relative group w-full overflow-hidden">
                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-white/5 group-hover:bg-insanus-red transition-colors"></div>
                            <div className="flex justify-between items-center mb-4 w-full relative z-10">
                                <div className="flex items-center gap-2 flex-1">
                                    <button onClick={() => toggleExpand(sub.id)} className={`text-gray-500 hover:text-white transition-transform shrink-0 ${isExpanded(sub.id) ? 'rotate-180' : ''}`}>
                                        <Icon.ChevronDown className="w-4 h-4" />
                                    </button>
                                    <input value={sub.name} onChange={e => { const idx = plan.disciplines.findIndex(d => d.id === disc.id); const nd = [...plan.disciplines]; const subIdx = nd[idx].subjects.findIndex(s => s.id === sub.id); nd[idx].subjects[subIdx].name = e.target.value; onUpdate({...plan, disciplines: nd}); }} className="bg-transparent font-bold text-insanus-red focus:text-white focus:outline-none text-sm w-full uppercase tracking-widest" />
                                </div>
                                <div className="flex gap-2 shrink-0 items-center">
                                    <div className="flex gap-1 mr-2">
                                        <button onClick={() => moveSubject(disc.id, sIdx, 'up')} disabled={sIdx === 0} className="p-1 text-gray-500 hover:text-white disabled:opacity-20 transition"><Icon.ArrowUp className="w-3.5 h-3.5"/></button>
                                        <button onClick={() => moveSubject(disc.id, sIdx, 'down')} disabled={sIdx === disc.subjects.length - 1} className="p-1 text-gray-500 hover:text-white disabled:opacity-20 transition"><Icon.ArrowDown className="w-3.5 h-3.5"/></button>
                                    </div>
                                    <button onClick={() => setSubjectToCopy(sub)} className="p-1.5 text-gray-500 hover:text-white transition bg-white/5 border border-white/10 rounded" title="Copiar Assunto para outro Plano"><Icon.Copy className="w-3.5 h-3.5"/></button>
                                    <button onClick={() => addGoal(disc.id, sub.id)} className="text-[10px] bg-insanus-red hover:bg-red-600 px-3 py-1 rounded text-white font-bold shadow-neon transition-all uppercase tracking-widest">+ META</button>
                                    <SafeDeleteBtn onDelete={() => { const idx = plan.disciplines.findIndex(d => d.id === disc.id); const nd = [...plan.disciplines]; nd[idx].subjects = nd[idx].subjects.filter(s => s.id !== sub.id); onUpdate({...plan, disciplines: nd}); }} />
                                </div>
                            </div>
                            {isExpanded(sub.id) && (
                                <div className="space-y-2 animate-fade-in w-full relative z-10">
                                    {sub.goals.map((goal, gIdx) => (
                                        <GoalEditor 
                                            key={goal.id} 
                                            goal={goal} 
                                            onUpdate={(g) => { const discIndex = plan.disciplines.findIndex(d => d.id === disc.id); const subIndex = plan.disciplines[discIndex].subjects.findIndex(s => s.id === sub.id); const goalIndex = plan.disciplines[discIndex].subjects[subIndex].goals.findIndex(g => g.id === goal.id); const newDiscs = [...plan.disciplines]; newDiscs[discIndex].subjects[subIndex].goals[goalIndex] = g; onUpdate({...plan, disciplines: newDiscs}); }} 
                                            onDelete={() => { const discIndex = plan.disciplines.findIndex(d => d.id === disc.id); const subIndex = plan.disciplines[discIndex].subjects.findIndex(s => s.id === sub.id); const newDiscs = [...plan.disciplines]; newDiscs[discIndex].subjects[subIndex].goals = newDiscs[discIndex].subjects[subIndex].goals.filter(g => g.id !== goal.id); onUpdate({...plan, disciplines: newDiscs}); }} 
                                            onMove={(dir) => moveGoal(disc.id, sub.id, gIdx, dir)}
                                            isFirst={gIdx === 0}
                                            isLast={gIdx === sub.goals.length - 1}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
    
    // Find active category definition to show subcategories
    const activeCategoryDef = categories.find(c => c.name === plan.category);

    return (
        <div className="flex flex-col h-full w-full bg-[#050505] text-white overflow-hidden">
             {/* COPY SUBJECT MODAL */}
             {subjectToCopy && (
                <SubjectMigrationModal 
                    allPlans={allPlans}
                    sourceSubject={subjectToCopy}
                    onClose={() => setSubjectToCopy(null)}
                    onConfirm={handleCopySubject}
                />
             )}

             <div className="h-16 border-b border-white/5 flex items-center justify-between px-6 shrink-0 bg-[#0F0F0F] z-20 w-full">
                <div className="flex items-center gap-4"><button onClick={onBack} className="text-gray-500 hover:text-white shrink-0 transition-colors"><Icon.ArrowUp className="-rotate-90 w-6 h-6" /></button><span className="text-gray-500 font-mono text-[10px] uppercase tracking-widest shrink-0">Configurações do Plano</span></div>
                <div className="flex gap-4 shrink-0">
                    <button onClick={handleSync} disabled={saving} className="bg-green-600 hover:bg-green-500 text-white px-5 py-2 rounded-lg font-bold text-xs flex items-center gap-2 shadow-neon transition-all uppercase tracking-widest">{saving ? <Icon.RefreshCw className="w-4 h-4 animate-spin" /> : <Icon.Check className="w-4 h-4" />} {saving ? 'SALVANDO...' : 'SALVAR ALTERAÇÕES'}</button>
                    <div className="h-8 w-px bg-white/5 mx-1"></div>
                    <button onClick={() => setTab('struct')} className={`px-4 py-2 text-[10px] font-bold rounded uppercase tracking-widest transition-all ${tab==='struct' ? 'bg-insanus-red text-white shadow-neon' : 'text-gray-500 hover:text-white'}`}>ESTRUTURA</button>
                    <button onClick={() => setTab('cycles')} className={`px-4 py-2 text-[10px] font-bold rounded uppercase tracking-widest transition-all ${tab==='cycles' ? 'bg-insanus-red text-white shadow-neon' : 'text-gray-500 hover:text-white'}`}>CICLOS</button>
                    <button onClick={() => setTab('edital')} className={`px-4 py-2 text-[10px] font-bold rounded flex items-center gap-2 uppercase tracking-widest transition-all ${tab==='edital' ? 'bg-insanus-red text-white shadow-neon' : 'text-gray-500 hover:text-white'}`}><Icon.List className="w-3 h-3"/> EDITAL</button>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar w-full relative">
                <div className="w-full">
                    {/* Cover & Info section */}
                    <div className="flex flex-col md:flex-row gap-8 mb-10 items-start border-b border-white/5 pb-8 w-full">
                        <div className="shrink-0 group relative w-40 h-40 rounded-2xl border-2 border-dashed border-white/10 bg-black/40 overflow-hidden hover:border-insanus-red transition-all shadow-2xl">
                            {plan.coverImage ? ( <img src={plan.coverImage} className="w-full h-full object-cover" /> ) : ( <div className="flex flex-col items-center justify-center h-full text-gray-700"><Icon.Image className="w-10 h-10 mb-2" /><span className="text-[9px] uppercase font-black tracking-widest text-center px-2">SEM CAPA</span></div> )}
                            <label className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-white text-[10px] font-black text-center p-2 uppercase tracking-widest">{uploadingCover ? <Icon.RefreshCw className="w-6 h-6 animate-spin mb-1"/> : <Icon.Edit className="w-6 h-6 mb-1 text-insanus-red" />} {uploadingCover ? 'ENVIANDO' : 'ALTERAR CAPA'}<input type="file" className="hidden" accept="image/*" onChange={handleCoverUpload} disabled={uploadingCover} /></label>
                        </div>
                        <div className="flex-1 pt-2 w-full">
                            <div className="flex justify-between items-start">
                                <div className="flex-1">
                                    <label className="text-[10px] font-black text-insanus-red uppercase tracking-[0.2em] mb-2 block">Identificação do Plano</label>
                                    <input value={plan.name} onChange={e => onUpdate({...plan, name: e.target.value})} className="bg-transparent text-4xl font-black text-white focus:outline-none border-b border-white/5 focus:border-insanus-red placeholder-gray-800 w-full mb-6 pb-2 transition-all" placeholder="Nome do plano..." />
                                </div>
                                <div className="ml-8 flex flex-col gap-4">
                                    <div className="flex gap-2">
                                        <div className="flex-1">
                                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 block">Categoria</label>
                                            <select value={plan.category || ''} onChange={e => onUpdate({...plan, category: e.target.value as PlanCategory, subCategory: undefined})} className="bg-black/60 border border-white/5 rounded-lg p-2.5 text-[10px] text-white uppercase font-black outline-none focus:border-insanus-red w-full transition-all tracking-widest">
                                                <option value="">-- SELECIONE --</option>
                                                {categories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                                            </select>
                                        </div>
                                        <div className="flex-1">
                                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 block">Subcategoria</label>
                                            <select value={plan.subCategory || ''} onChange={e => onUpdate({...plan, subCategory: e.target.value})} className="bg-black/60 border border-white/5 rounded-lg p-2.5 text-[10px] text-white uppercase font-black outline-none focus:border-insanus-red w-full transition-all tracking-widest" disabled={!plan.category}>
                                                <option value="">-- SELECIONE --</option>
                                                {activeCategoryDef?.subCategories.map(s => <option key={s} value={s}>{s}</option>)}
                                            </select>
                                        </div>
                                        <div className="flex-1">
                                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 block">Órgão</label>
                                            <input value={plan.organization || ''} onChange={e => onUpdate({...plan, organization: e.target.value.toUpperCase()})} className="bg-black/60 border border-white/5 rounded-lg p-2.5 text-[10px] text-white uppercase font-black outline-none focus:border-insanus-red w-full transition-all tracking-widest" placeholder="EX: PC/AC" />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 block">Sistema de Ciclo</label>
                                        <select value={plan.cycleSystem || 'continuo'} onChange={e => onUpdate({...plan, cycleSystem: e.target.value as 'continuo' | 'rotativo'})} className="bg-black/60 border border-white/5 rounded-lg p-2.5 text-[10px] text-white uppercase font-black outline-none focus:border-insanus-red w-full transition-all tracking-widest"><option value="continuo">Contínuo</option><option value="rotativo">Rotativo</option></select>
                                    </div>
                                    
                                    {/* NEW: ACTIVE USER MODE TOGGLE */}
                                    <div>
                                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 block">
                                            Função Usuário Ativo
                                        </label>
                                        <div className="flex items-center gap-2 bg-black/60 border border-white/5 rounded-lg p-2.5 w-full">
                                            <input
                                                type="checkbox"
                                                id="activeUserMode"
                                                checked={plan.enableActiveUserMode || false}
                                                onChange={e => onUpdate({...plan, enableActiveUserMode: e.target.checked})}
                                                className="accent-insanus-red w-4 h-4 cursor-pointer"
                                            />
                                            <label htmlFor="activeUserMode" className="text-[10px] text-white font-bold uppercase cursor-pointer select-none">
                                                Permitir Conclusão Manual
                                            </label>
                                        </div>
                                    </div>

                                    {/* NEW: PURCHASE LINK */}
                                    <div>
                                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 block">
                                            LINK PARA USUÁRIO QUE NÃO POSSUEM O PLANO
                                        </label>
                                        <input
                                            value={plan.purchaseLink || ''}
                                            onChange={e => onUpdate({...plan, purchaseLink: e.target.value})}
                                            className="bg-black/60 border border-white/10 rounded-lg p-3 text-[10px] text-white outline-none focus:border-insanus-red w-full transition-all tracking-widest placeholder-gray-700 font-mono"
                                            placeholder="https://..."
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-4 mt-6">
                                <div className="bg-white/5 px-6 py-4 rounded-xl border border-white/5 flex flex-col hover:border-white/10 transition-colors"><span className="text-3xl font-black text-white leading-none">{plan.disciplines.length}</span><span className="text-[9px] text-gray-500 uppercase font-black tracking-widest mt-2">Disciplinas</span></div>
                                <div className="bg-white/5 px-6 py-4 rounded-xl border border-white/5 flex flex-col hover:border-white/10 transition-colors"><span className="text-3xl font-black text-white leading-none">{plan.cycles.length}</span><span className="text-[9px] text-gray-500 uppercase font-black tracking-widest mt-2">Ciclos</span></div>
                                <div className="bg-white/5 px-6 py-4 rounded-xl border border-white/5 flex flex-col hover:border-white/10 transition-colors"><span className="text-3xl font-black text-white leading-none">{plan.linkedSimuladoClasses?.length || 0}</span><span className="text-[9px] text-gray-500 uppercase font-black tracking-widest mt-2">Turmas Vinc.</span></div>
                            </div>
                        </div>
                    </div>

                    {tab === 'struct' && (
                        <div className="w-full space-y-12 pb-10">
                            {/* ... (Existing struct logic) ... */}
                            <div className="flex justify-end">
                                <button onClick={() => setShowSimuladoLinks(!showSimuladoLinks)} className="text-[10px] font-black text-gray-500 hover:text-white flex items-center gap-2 transition-all uppercase tracking-widest">
                                    <Icon.Link className="w-3.5 h-3.5"/> {showSimuladoLinks ? 'OCULTAR VÍNCULOS' : 'GERENCIAR TURMAS DE SIMULADOS'}
                                </button>
                            </div>
                            {showSimuladoLinks && (
                                <div className="bg-[#121212] p-6 rounded-2xl border border-white/5 mb-8 animate-fade-in w-full">
                                    <h4 className="text-[10px] font-black text-white uppercase mb-6 flex items-center gap-2 tracking-[0.2em]">Vincular Turmas ao Plano</h4>
                                    <div className="flex flex-wrap gap-3">
                                        {allSimuladoClasses.map(cls => { 
                                            const isLinked = plan.linkedSimuladoClasses?.includes(cls.id); 
                                            return (
                                                <button key={cls.id} onClick={() => toggleLinkedSimuladoClass(cls.id)} className={`px-5 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${isLinked ? 'bg-insanus-red border-insanus-red text-white shadow-neon' : 'bg-black/40 border-white/5 text-gray-500 hover:border-white/20'}`}>
                                                    {isLinked && <Icon.Check className="w-3 h-3"/>}{cls.name}
                                                </button>
                                            )
                                        })}
                                        {allSimuladoClasses.length === 0 && <span className="text-gray-700 italic text-[10px] font-mono">Nenhuma turma de simulados disponível.</span>}
                                    </div>
                                </div>
                            )}
                            <div className="bg-[#121212] rounded-2xl border border border-white/5 overflow-hidden w-full">
                                <div className="bg-[#1E1E1E] p-4 flex justify-between items-center border-b border-white/5">
                                    <div className="flex items-center gap-3"><Icon.BookOpen className="w-5 h-5 text-insanus-red" /><span className="font-black text-gray-200 uppercase tracking-[0.15em] text-sm">Disciplinas Gerais</span></div>
                                    <button onClick={() => addDiscipline()} className="text-[10px] bg-white/5 hover:bg-white/10 text-white px-4 py-2 rounded-lg font-black transition-all uppercase tracking-widest">+ NOVA DISCIPLINA</button>
                                </div>
                                <div className="p-6 bg-[#121212] w-full">
                                    {plan.disciplines.filter(d => !d.folderId).map((d, i, arr) => renderDiscipline(d, i, arr))}
                                    {plan.disciplines.filter(d => !d.folderId).length === 0 && (<div className="text-center py-12 text-gray-700 text-[10px] font-mono border border-dashed border-white/5 rounded-xl uppercase tracking-widest">Nenhuma disciplina na raiz do plano.</div>)}
                                </div>
                            </div>
                            <div className="space-y-8 w-full">
                                <div className="flex items-center justify-between border-b border-white/5 pb-4 w-full">
                                    <h3 className="text-lg font-black text-white uppercase tracking-[0.1em]">Pastas do Sistema</h3>
                                    <button onClick={addFolder} className="text-[10px] bg-insanus-red hover:bg-red-600 text-white px-5 py-2.5 rounded-xl font-black flex items-center gap-2 shadow-neon uppercase tracking-widest transition-all"><Icon.FolderPlus className="w-4 h-4" /> CRIAR NOVA PASTA</button>
                                </div>
                                {plan.folders.map(folder => (
                                    <div key={folder.id} className="bg-[#121212] rounded-2xl border border-white/5 overflow-hidden transition-all w-full">
                                        <div className="bg-[#1E1E1E] p-4 flex justify-between items-center border-b border-white/5">
                                            <div className="flex items-center gap-3">
                                                <button onClick={() => toggleExpand(folder.id)} className={`text-gray-400 hover:text-white transition-transform ${isExpanded(folder.id) ? 'rotate-180' : ''}`}><Icon.ChevronDown className="w-5 h-5" /></button>
                                                <Icon.Folder className="w-5 h-5 text-insanus-red" />
                                                <input value={folder.name} onChange={e => { const nf = plan.folders.map(f => f.id === folder.id ? {...f, name: e.target.value} : f); onUpdate({...plan, folders: nf}); }} className="bg-transparent font-black text-white focus:outline-none w-64 text-lg transition-all" />
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <button onClick={() => addDiscipline(folder.id)} className="text-[10px] bg-insanus-red/10 border border-insanus-red/20 text-insanus-red px-4 py-2 rounded-lg hover:bg-insanus-red hover:text-white font-black transition-all uppercase tracking-widest">+ DISCIPLINA</button>
                                                <SafeDeleteBtn onDelete={() => onUpdate({ ...plan, folders: plan.folders.filter(f => f.id !== folder.id), disciplines: plan.disciplines.map(d => d.folderId === folder.id ? { ...d, folderId: undefined } : d) as Discipline[] })} />
                                            </div>
                                        </div>
                                        {isExpanded(folder.id) && (<div className="p-6 animate-fade-in w-full">{plan.disciplines.filter(d => d.folderId === folder.id).map((d, i, arr) => renderDiscipline(d, i, arr))}</div>)}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {tab === 'cycles' && (<div className="w-full pb-10"><div className="flex justify-between items-center mb-8 border-b border-white/5 pb-6 w-full"><div><h3 className="text-2xl font-black text-white uppercase tracking-tight">Gestão de Ciclos</h3><p className="text-gray-600 text-[10px] font-bold uppercase tracking-widest mt-1">Configuração de sequências rotativas ou fixas.</p></div><button onClick={() => onUpdate({ ...plan, cycles: [...plan.cycles, { id: uuid(), name: 'Novo Ciclo', items: [], order: plan.cycles.length }] })} className="bg-insanus-red hover:bg-red-600 text-white px-5 py-3 rounded-xl font-black flex items-center gap-2 shadow-neon transition-all uppercase tracking-widest"><Icon.Plus className="w-4 h-4" /> CRIAR CICLO</button></div>{plan.cycles.length === 0 ? (<div className="flex flex-col items-center justify-center h-80 text-gray-700 border border-dashed border-white/5 rounded-3xl w-full gap-4"><Icon.RefreshCw className="w-16 h-16 opacity-10"/><p className="text-[10px] font-black uppercase tracking-widest">Nenhum ciclo configurado para este plano.</p></div>) : (<div className="w-full">{plan.cycles.map(cycle => (<CycleEditor key={cycle.id} cycle={cycle} allDisciplines={plan.disciplines} allFolders={plan.folders} linkedSimulados={allSimuladoClasses.filter(c => plan.linkedSimuladoClasses?.includes(c.id))} onUpdate={(uc) => onUpdate({ ...plan, cycles: plan.cycles.map(c => c.id === uc.id ? uc : c) })} onDelete={() => onUpdate({ ...plan, cycles: plan.cycles.filter(c => c.id !== cycle.id) })} />))}</div>)}</div>)}
                    {tab === 'edital' && (
                        <div className="w-full space-y-8 animate-fade-in pb-10">
                            <div className="flex justify-between items-center mb-8 border-b border-white/5 pb-6 w-full">
                                <div>
                                    <h3 className="text-2xl font-black text-white uppercase tracking-tight">Edital Verticalizado</h3>
                                    <p className="text-gray-600 text-[10px] font-bold uppercase tracking-widest mt-1">Mapeamento granular do edital para as metas do plano.</p>
                                </div>
                                <button onClick={() => { const newDisc: EditalDiscipline = { id: uuid(), name: 'Nova Disciplina', topics: [], order: 0 }; setEditalExpandedMap(prev => ({ ...prev, [newDisc.id]: true })); onUpdate({ ...plan, editalVerticalizado: [...(plan.editalVerticalizado || []), newDisc] }); }} className="bg-insanus-red hover:bg-red-600 text-white px-5 py-3 rounded-xl font-black flex items-center gap-2 shadow-neon transition-all uppercase tracking-widest">
                                    <Icon.Plus className="w-4 h-4" /> NOVA DISCIPLINA EDITAL
                                </button>
                            </div>
                            {(!plan.editalVerticalizado || plan.editalVerticalizado.length === 0) ? (
                                <div className="flex flex-col items-center justify-center h-80 text-gray-700 border border-dashed border-white/5 rounded-3xl w-full gap-4">
                                    <Icon.List className="w-16 h-16 opacity-10"/><p className="text-[10px] font-black uppercase tracking-widest">Mapeamento de edital pendente.</p>
                                </div>
                            ) : (
                                <div className="grid gap-8 w-full">
                                    {plan.editalVerticalizado.map((disc, dIdx) => (
                                        <div key={disc.id} className="bg-[#121212] rounded-2xl border border-white/5 overflow-hidden w-full">
                                            <div className="bg-[#1E1E1E] p-4 flex justify-between items-center border-b border-white/5">
                                                <div className="flex items-center gap-3 flex-1">
                                                    <button onClick={() => toggleEditalExpand(disc.id)} className={`text-gray-400 hover:text-white transition-transform ${isEditalExpanded(disc.id) ? 'rotate-180' : ''}`}>
                                                        <Icon.ChevronDown className="w-5 h-5"/>
                                                    </button>
                                                    <div className="w-2 h-8 bg-insanus-red rounded-full shrink-0"></div>
                                                    <input value={disc.name} onChange={e => { const ne = [...(plan.editalVerticalizado||[])]; ne[dIdx].name = e.target.value; onUpdate({...plan, editalVerticalizado: ne}); }} className="bg-transparent font-black text-white focus:outline-none w-full text-lg uppercase tracking-tight" placeholder="NOME DA DISCIPLINA" />
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <div className="flex gap-1">
                                                        {dIdx > 0 && (
                                                            <button onClick={() => moveEditalDiscipline(dIdx, 'up')} className="p-2 text-gray-500 hover:text-blue-400 transition-colors" title="Subir Disciplina">
                                                                <Icon.ArrowUp className="w-4 h-4" />
                                                            </button>
                                                        )}
                                                        {dIdx < (plan.editalVerticalizado?.length || 0) - 1 && (
                                                            <button onClick={() => moveEditalDiscipline(dIdx, 'down')} className="p-2 text-gray-500 hover:text-blue-400 transition-colors" title="Descer Disciplina">
                                                                <Icon.ArrowDown className="w-4 h-4" />
                                                            </button>
                                                        )}
                                                    </div>
                                                    <button onClick={() => { const ne = [...(plan.editalVerticalizado||[])]; ne[dIdx].topics.push({id: uuid(), name: 'Novo Tópico', links: {}, order: 0}); onUpdate({...plan, editalVerticalizado: ne}); }} className="text-[10px] bg-insanus-red/10 border border-insanus-red/20 text-insanus-red px-4 py-2 rounded-lg hover:bg-insanus-red hover:text-white font-black transition-all uppercase tracking-widest">+ TÓPICO</button>
                                                    <SafeDeleteBtn onDelete={() => onUpdate({ ...plan, editalVerticalizado: (plan.editalVerticalizado||[]).filter((_, idx) => idx !== dIdx) })} />
                                                </div>
                                            </div>
                                            {isEditalExpanded(disc.id) && (
                                                <div className="p-4 bg-[#121212] w-full animate-fade-in">
                                                    {disc.topics.map((topic, tIdx) => (
                                                        <EditalTopicEditor 
                                                            key={topic.id} 
                                                            topic={topic} 
                                                            plan={plan} 
                                                            onUpdate={(t) => { const ne = [...(plan.editalVerticalizado||[])]; ne[dIdx].topics[tIdx] = t; onUpdate({...plan, editalVerticalizado: ne}); }} 
                                                            onDelete={() => { const ne = [...(plan.editalVerticalizado||[])]; ne[dIdx].topics = ne[dIdx].topics.filter((_, idx) => idx !== tIdx); onUpdate({...plan, editalVerticalizado: ne}); }} 
                                                            onMove={(direction) => moveEditalTopic(dIdx, tIdx, direction)}
                                                            isFirst={tIdx === 0}
                                                            isLast={tIdx === disc.topics.length - 1}
                                                        />
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// SimuladoEditor Component
interface SimuladoEditorProps {
    simClass: SimuladoClass;
    categories: CategoryDefinition[]; // NEW: Receives categories
    onUpdate: (sc: SimuladoClass) => void;
    onBack: () => void;
}
const SimuladoEditor: React.FC<SimuladoEditorProps> = ({ simClass, categories, onUpdate, onBack }) => {
    const [selectedSimulado, setSelectedSimulado] = useState<Simulado | null>(null);
    const [uploading, setUploading] = useState(false);
    const [uploadingCover, setUploadingCover] = useState(false); // NEW
    const [saving, setSaving] = useState(false);
    
    // Find active category definition to show subcategories in Editor
    const activeCategoryDef = categories.find(c => c.name === simClass.category);

    const handleSync = async () => { 
        setSaving(true); 
        try { 
            await saveSimuladoClassToDB(simClass); 
            await new Promise(r => setTimeout(r, 800)); 
            alert("Turma salva com sucesso!"); 
        } catch (e) { 
            alert("Erro ao salvar."); 
        } finally { 
            setSaving(false); 
        } 
    };

    const addSimulado = () => { onUpdate({ ...simClass, simulados: [...simClass.simulados, { id: uuid(), title: "Novo Simulado", type: "MULTIPLA_ESCOLHA", optionsCount: 5, totalQuestions: 10, hasPenalty: false, hasBlocks: false, blocks: [], correctAnswers: {}, questionValues: {}, hasDiagnosis: false, diagnosisMap: {} }] }); setSelectedSimulado(null); }; 
    const updateSimulado = (sim: Simulado) => { const updatedList = simClass.simulados.map(s => s.id === sim.id ? sim : s); onUpdate({ ...simClass, simulados: updatedList }); setSelectedSimulado(sim); };
    const deleteSimulado = (id: string) => { if (!confirm("Excluir simulado?")) return; onUpdate({ ...simClass, simulados: simClass.simulados.filter(s => s.id !== id) }); setSelectedSimulado(null); };
    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>, sim: Simulado, field: 'pdfUrl' | 'gabaritoPdfUrl') => { if (!e.target.files || !e.target.files[0]) return; setUploading(true); try { const url = await uploadFileToStorage(e.target.files[0], 'simulados'); updateSimulado({ ...sim, [field]: url }); } catch(err) { alert("Erro upload"); } finally { setUploading(false); } }

    // NEW: Handle Cover Upload for Simulado Class
    const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || !e.target.files[0]) return;
        setUploadingCover(true);
        try {
            const url = await uploadFileToStorage(e.target.files[0], 'covers');
            onUpdate({ ...simClass, coverImage: url });
        } catch (err) {
            alert("Erro ao enviar imagem.");
        } finally {
            setUploadingCover(false);
        }
    };

    if (selectedSimulado) {
        const s = selectedSimulado;
        return (
            <div className="flex flex-col h-full w-full bg-[#050505] text-gray-200">
                <div className="flex items-center gap-4 border-b border-white/5 p-4 bg-[#0F0F0F] shrink-0 w-full"><button onClick={() => setSelectedSimulado(null)} className="text-gray-400 hover:text-white shrink-0"><Icon.ArrowUp className="-rotate-90 w-6 h-6"/></button><span className="font-bold text-white uppercase tracking-widest">{s.title}</span></div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8 w-full"><div className="w-full space-y-8"><div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full"><div><label className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Título</label><input value={s.title} onChange={e => updateSimulado({...s, title: e.target.value})} className="w-full bg-black/40 border border-white/5 p-2 rounded text-white focus:border-insanus-red outline-none"/></div><div className="grid grid-cols-2 gap-4">{s.type === 'MULTIPLA_ESCOLHA' && (<div><label className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Qtd. Opções</label><input type="number" min="2" max="5" value={s.optionsCount} onChange={e => updateSimulado({...s, optionsCount: Number(e.target.value)})} className="w-full bg-black/40 border border-white/5 p-2 rounded text-white focus:border-insanus-red outline-none"/></div>)}<div><label className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Tipo</label><select value={s.type} onChange={e => updateSimulado({...s, type: e.target.value as any})} className="w-full bg-black/40 border border-white/5 p-2 rounded text-white focus:border-insanus-red outline-none"><option value="MULTIPLA_ESCOLHA">Múltipla Escolha</option><option value="CERTO_ERRADO">Certo / Errado</option></select></div><div><label className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Qtd. Questões</label><input type="number" value={s.totalQuestions} onChange={e => updateSimulado({...s, totalQuestions: Number(e.target.value)})} className="w-full bg-black/40 border border-white/5 p-2 rounded text-white focus:border-insanus-red outline-none"/></div></div><div><label className="text-[10px] text-gray-500 uppercase font-bold block mb-1 tracking-widest">Caderno de Questões (PDF)</label><input type="file" onChange={e => handleFile(e, s, 'pdfUrl')} className="text-xs text-gray-400"/>{s.pdfUrl && <span className="text-xs text-green-500 ml-2">Anexado</span>}</div><div><label className="text-[10px] text-gray-500 uppercase font-bold block mb-1 tracking-widest">Gabarito Comentado (PDF)</label><input type="file" onChange={e => handleFile(e, s, 'gabaritoPdfUrl')} className="text-xs text-gray-400"/>{s.gabaritoPdfUrl && <span className="text-xs text-green-500 ml-2">Anexado</span>}</div><div className="col-span-1 md:col-span-2 flex flex-col md:flex-row gap-6"><label className="flex items-center gap-2 cursor-pointer group"><input type="checkbox" checked={s.hasPenalty} onChange={e => updateSimulado({...s, hasPenalty: e.target.checked})} className="accent-insanus-red w-4 h-4"/><span className="text-xs font-bold text-gray-400 group-hover:text-white uppercase tracking-widest">Sistema de Penalidade (1 Errada anula 1 Certa)</span></label><label className="flex items-center gap-2 cursor-pointer group"><input type="checkbox" checked={s.hasDiagnosis} onChange={e => updateSimulado({...s, hasDiagnosis: e.target.checked})} className="accent-insanus-red w-4 h-4"/><span className="text-xs font-bold text-gray-400 group-hover:text-white uppercase tracking-widest">Ativar Autodiagnóstico</span></label></div></div><div className="bg-[#121212] p-4 rounded-xl border border-white/5 w-full"><div className="flex justify-between items-center mb-4"><h4 className="text-sm font-bold text-white uppercase tracking-widest">Divisão de Blocos</h4><button onClick={() => updateSimulado({...s, hasBlocks: !s.hasBlocks})} className={`text-[10px] px-3 py-1 rounded font-bold transition-all ${s.hasBlocks ? 'bg-insanus-red text-white shadow-neon' : 'bg-white/5 text-gray-500'}`}>{s.hasBlocks ? 'ATIVADO' : 'DESATIVADO'}</button></div>{s.hasBlocks && (<div className="space-y-2">{s.blocks.map((b, idx) => (<div key={idx} className="flex gap-2"><input value={b.name} onChange={e => { const nb = [...s.blocks]; nb[idx].name = e.target.value; updateSimulado({...s, blocks: nb}); }} placeholder="Nome Bloco" className="bg-black/40 p-2 text-xs text-white border border-white/5 rounded focus:border-insanus-red outline-none flex-1"/><input type="number" value={b.questionCount} onChange={e => { const nb = [...s.blocks]; nb[idx].questionCount = Number(e.target.value); updateSimulado({...s, blocks: nb}); }} placeholder="Qtd" className="w-20 bg-black/40 p-2 text-xs text-white border border-white/5 rounded focus:border-insanus-red outline-none"/><input type="number" value={b.minCorrect} onChange={e => { const nb = [...s.blocks]; nb[idx].minCorrect = Number(e.target.value); updateSimulado({...s, blocks: nb}); }} placeholder="Mín. Acertos" className="w-24 bg-black/40 p-2 text-xs text-white border border-white/5 rounded focus:border-insanus-red outline-none"/><button onClick={() => { const nb = s.blocks.filter((_, i) => i !== idx); updateSimulado({...s, blocks: nb}); }} className="text-gray-500 hover:text-red-500 transition-colors"><Icon.Trash className="w-4 h-4"/></button></div>))}<button onClick={() => updateSimulado({...s, blocks: [...s.blocks, {id: uuid(), name: `Bloco ${s.blocks.length+1}`, questionCount: 10}]})} className="text-[10px] font-bold text-insanus-red hover:underline mt-2">+ ADICIONAR NOVO BLOCO</button></div>)}<div className="mt-4 pt-4 border-t border-white/5 flex items-center gap-4"><label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Mínimo % Geral para Aprovação</label><div className="flex items-center gap-2"><input type="number" value={s.minTotalPercent || 0} onChange={e => updateSimulado({...s, minTotalPercent: Number(e.target.value)})} className="w-20 bg-black/40 p-2 text-xs text-white border border-white/5 rounded focus:border-insanus-red outline-none text-center"/> <span className="text-xs text-gray-500">%</span></div></div></div><div className="bg-[#121212] p-4 rounded-xl border border-white/5 w-full"><h4 className="text-sm font-bold text-white mb-6 uppercase tracking-widest">Gabarito e Configuração das Questões</h4><div className="grid grid-cols-1 gap-2">{Array.from({length: s.totalQuestions}).map((_, i) => { const qNum = i + 1; const diag = s.diagnosisMap[qNum] || { discipline: '', topic: '' }; const ans = s.correctAnswers[qNum] || ''; const val = s.questionValues[qNum] || 1; return (<div key={qNum} className="flex flex-wrap items-center gap-2 bg-black/20 p-2 rounded border border border-white/5 hover:border-white/10 transition-colors"><div className="w-8 h-8 flex items-center justify-center bg-white/5 rounded font-bold text-xs shrink-0 text-gray-400">{qNum}</div><div className="flex flex-col shrink-0"><label className="text-[8px] uppercase text-gray-600 font-bold">Resp.</label><input value={ans} onChange={e => updateSimulado({ ...s, correctAnswers: {...s.correctAnswers, [qNum]: e.target.value.toUpperCase()} })} className="w-10 bg-black/60 text-center text-xs font-bold text-insanus-red p-1 rounded border border-white/5" maxLength={1} /></div><div className="flex flex-col shrink-0"><label className="text-[8px] uppercase text-gray-600 font-bold">Pontos</label><input type="number" value={val} onChange={e => updateSimulado({ ...s, questionValues: {...s.questionValues, [qNum]: Number(e.target.value)} })} className="w-12 bg-black/60 text-center text-xs p-1 rounded border border-white/5 text-gray-300" /></div>{s.hasDiagnosis && (<><div className="flex flex-col flex-1 min-w-[100px]"><label className="text-[8px] uppercase text-gray-600 font-bold">Disciplina</label><input value={diag.discipline} onChange={e => updateSimulado({ ...s, diagnosisMap: {...s.diagnosisMap, [qNum]: {...diag, discipline: e.target.value}} })} className="bg-black/60 text-xs p-1 rounded border border-white/5 w-full text-gray-300" placeholder="Ex: Direito Const." /></div><div className="flex flex-col flex-1 min-w-[100px]"><label className="text-[8px] uppercase text-gray-600 font-bold">Assunto/Tópico</label><input value={diag.topic} onChange={e => updateSimulado({ ...s, diagnosisMap: {...s.diagnosisMap, [qNum]: {...diag, topic: e.target.value}} })} className="bg-black/60 text-xs p-1 rounded border border-white/5 w-full text-gray-300" placeholder="Ex: Direitos Fund." /></div><div className="flex flex-col flex-1 min-w-[100px]"><label className="text-[8px] uppercase text-gray-600 font-bold">Obs (Opcional)</label><input value={diag.observation || ''} onChange={e => updateSimulado({ ...s, diagnosisMap: {...s.diagnosisMap, [qNum]: {...diag, observation: e.target.value}} })} className="bg-black/60 text-xs p-1 rounded border border-white/5 w-full text-gray-400" placeholder="Comentário..." /></div></>)}</div>)})}</div></div></div></div></div>
        );
    }
    return (
         <div className="flex flex-col h-full w-full bg-[#050505] text-gray-200">
            <div className="flex items-center justify-between border-b border-white/5 p-4 bg-[#0F0F0F] shrink-0 w-full"><div className="flex items-center gap-4"><button onClick={onBack} className="text-gray-400 hover:text-white shrink-0 transition-colors"><Icon.ArrowUp className="-rotate-90 w-6 h-6"/></button><div><h2 className="font-bold text-white uppercase tracking-widest">{simClass.name}</h2><input value={simClass.name} onChange={e => onUpdate({...simClass, name: e.target.value})} className="bg-transparent text-xs text-gray-500 focus:text-white border-b border-transparent focus:border-white/10 outline-none transition-all w-48" placeholder="Editar nome da turma..."/></div></div>
            <div className="flex gap-2">
                <button onClick={handleSync} disabled={saving} className="bg-green-600 hover:bg-green-500 text-white px-5 py-2 rounded-lg font-bold text-xs flex items-center gap-2 shadow-neon transition-all uppercase tracking-widest shrink-0">{saving ? <Icon.RefreshCw className="w-4 h-4 animate-spin" /> : <Icon.Check className="w-4 h-4" />} SALVAR</button>
                <button onClick={() => { onUpdate({ ...simClass, simulados: [...simClass.simulados, { id: uuid(), title: "Novo Simulado", type: "MULTIPLA_ESCOLHA", optionsCount: 5, totalQuestions: 10, hasPenalty: false, hasBlocks: false, blocks: [], correctAnswers: {}, questionValues: {}, hasDiagnosis: false, diagnosisMap: {} }] }); }} className="bg-insanus-red text-white px-6 py-2 rounded text-xs font-bold uppercase shadow-neon shrink-0 transition-transform active:scale-95">+ NOVO SIMULADO</button>
            </div></div>
            <div className="flex-1 p-6 overflow-y-auto custom-scrollbar w-full">
                
                {/* CONFIGURAÇÕES GERAIS DA TURMA (CAPA, CATEGORIA E LINK DE VENDA) */}
                <div className="flex flex-col md:flex-row gap-6 mb-8 border-b border-white/5 pb-8 animate-fade-in">
                    <div className="shrink-0 group relative w-32 h-32 rounded-xl border-2 border-dashed border-white/10 bg-black/40 overflow-hidden hover:border-insanus-red transition-all shadow-2xl">
                        {simClass.coverImage ? ( <img src={simClass.coverImage} className="w-full h-full object-cover" /> ) : ( <div className="flex flex-col items-center justify-center h-full text-gray-700"><Icon.Image className="w-8 h-8 mb-2" /><span className="text-[8px] uppercase font-black tracking-widest text-center px-2">CAPA 1:1</span></div> )}
                        <label className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-white text-[9px] font-black text-center p-2 uppercase tracking-widest">{uploadingCover ? <Icon.RefreshCw className="w-5 h-5 animate-spin mb-1"/> : <Icon.Edit className="w-5 h-5 mb-1 text-insanus-red" />} {uploadingCover ? 'ENVIANDO' : 'ALTERAR'}<input type="file" className="hidden" accept="image/*" onChange={handleCoverUpload} disabled={uploadingCover} /></label>
                    </div>
                    <div className="flex-1 flex flex-col gap-4">
                        <div className="flex gap-2">
                            <div className="flex-1">
                                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 block">Categoria</label>
                                <select value={simClass.category || ''} onChange={e => onUpdate({...simClass, category: e.target.value, subCategory: undefined})} className="bg-black/60 border border-white/10 rounded-lg p-2.5 text-[10px] text-white uppercase font-black outline-none focus:border-insanus-red w-full transition-all tracking-widest">
                                    <option value="">-- SELECIONE --</option>
                                    {categories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                                </select>
                            </div>
                            <div className="flex-1">
                                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 block">Subcategoria</label>
                                <select value={simClass.subCategory || ''} onChange={e => onUpdate({...simClass, subCategory: e.target.value})} className="bg-black/60 border border-white/10 rounded-lg p-2.5 text-[10px] text-white uppercase font-black outline-none focus:border-insanus-red w-full transition-all tracking-widest" disabled={!simClass.category}>
                                    <option value="">-- SELECIONE --</option>
                                    {activeCategoryDef?.subCategories.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div className="flex-1">
                                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 block">Órgão</label>
                                <input value={simClass.organization || ''} onChange={e => onUpdate({...simClass, organization: e.target.value.toUpperCase()})} className="bg-black/60 border border-white/10 rounded-lg p-2.5 text-[10px] text-white uppercase font-black outline-none focus:border-insanus-red w-full transition-all tracking-widest" placeholder="EX: PC/AC" />
                            </div>
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 block">Link de Venda (Para quem não tem acesso)</label>
                            <input
                                value={simClass.purchaseLink || ''}
                                onChange={e => onUpdate({...simClass, purchaseLink: e.target.value})}
                                className="bg-black/40 border border-white/10 rounded-lg p-3 text-[10px] text-white outline-none focus:border-insanus-red w-full transition-all tracking-widest placeholder-gray-700 font-mono"
                                placeholder="https://..."
                            />
                            <p className="text-[9px] text-gray-600 mt-2">Se preenchido, usuários sem permissão verão um botão de compra ao invés do bloqueio padrão.</p>
                        </div>
                    </div>
                </div>

                {simClass.simulados.length === 0 ? (<div className="flex flex-col items-center justify-center h-full opacity-30 grayscale gap-4 min-h-[300px]"><Icon.List className="w-20 h-20"/><p className="font-mono text-sm uppercase tracking-widest italic">Nenhum simulado cadastrado nesta turma.</p></div>) : (<div className="grid gap-4 w-full grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{simClass.simulados.map((sim, idx) => (<div key={sim.id} className="bg-[#121212] border border-white/5 p-5 rounded-xl flex justify-between items-center hover:bg-white/5 hover:border-white/10 transition-all group w-full relative overflow-hidden"><div className="absolute top-0 left-0 w-1 h-full bg-insanus-red opacity-0 group-hover:opacity-100 transition-opacity"></div><div className="flex items-center gap-4"><span className="text-gray-600 font-mono text-xs shrink-0 tracking-widest">{idx + 1}.</span><div><h4 className="text-white font-bold tracking-tight">{sim.title}</h4><span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">{sim.totalQuestions} Questões • {sim.type.replace('_', ' ')}</span></div></div><div className="flex gap-2 relative z-10"><button onClick={() => setSelectedSimulado(sim)} className="bg-white/5 border border-white/5 hover:border-white/20 text-white px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all tracking-widest">EDITAR</button><button onClick={() => deleteSimulado(sim.id)} className="text-gray-600 hover:text-red-500 transition-colors p-2"><Icon.Trash className="w-4 h-4"/></button></div></div>))}</div>)}
            </div>
         </div>
    );
};

// EmbedModal Component
interface EmbedModalProps {
    onClose: () => void;
}
const EmbedModal: React.FC<EmbedModalProps> = ({ onClose }) => {
    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
            <div className="bg-[#121212] p-6 rounded-xl border border-[#333] w-full max-w-lg text-white">
                <h3 className="font-bold mb-4">Código de Incorporação</h3>
                <textarea readOnly className="w-full h-32 bg-black/40 border border-[#333] p-2 text-xs font-mono text-gray-400 rounded resize-none" value={`<iframe src="${window.location.origin}" width="100%" height="800px" frameborder="0"></iframe>`} />
                <button onClick={onClose} className="mt-4 w-full bg-insanus-red text-white py-2 rounded text-xs font-bold">FECHAR</button>
            </div>
        </div>
    );
};

// NEW: SUBJECT MIGRATION MODAL
interface SubjectMigrationModalProps {
    allPlans: StudyPlan[];
    sourceSubject: Subject;
    onClose: () => void;
    onConfirm: (targetPlanId: string, targetDisciplineId: string) => void;
}

const SubjectMigrationModal: React.FC<SubjectMigrationModalProps> = ({ allPlans, sourceSubject, onClose, onConfirm }) => {
    const [selectedPlanId, setSelectedPlanId] = useState('');
    const [selectedDisciplineId, setSelectedDisciplineId] = useState('');

    const targetPlan = allPlans.find(p => p.id === selectedPlanId);
    
    return (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-[#121212] border border-[#333] p-6 rounded-2xl w-full max-w-md shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-insanus-red"></div>
                <h3 className="text-xl font-bold text-white mb-4 uppercase flex items-center gap-2">
                    <Icon.Copy className="w-5 h-5 text-insanus-red"/> Copiar Assunto
                </h3>
                <p className="text-gray-400 text-xs mb-6">
                    Copiar <strong>"{sourceSubject.name}"</strong> com todas as suas metas, arquivos e configurações para outro plano/disciplina.
                </p>

                <div className="space-y-4 mb-6">
                    <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">1. Selecione o Plano de Destino</label>
                        <select 
                            value={selectedPlanId} 
                            onChange={e => { setSelectedPlanId(e.target.value); setSelectedDisciplineId(''); }}
                            className="w-full bg-[#1A1A1A] border border-[#333] rounded-lg p-3 text-white text-xs outline-none focus:border-insanus-red"
                        >
                            <option value="">-- Selecione --</option>
                            {allPlans.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">2. Selecione a Disciplina</label>
                        <select 
                            value={selectedDisciplineId} 
                            onChange={e => setSelectedDisciplineId(e.target.value)}
                            disabled={!selectedPlanId}
                            className="w-full bg-[#1A1A1A] border border-[#333] rounded-lg p-3 text-white text-xs outline-none focus:border-insanus-red disabled:opacity-50"
                        >
                            <option value="">{selectedPlanId ? '-- Selecione a Disciplina --' : '-- Aguardando Plano --'}</option>
                            {targetPlan?.disciplines.map(d => (
                                <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="flex gap-3">
                    <button onClick={onClose} className="flex-1 bg-transparent border border-gray-700 hover:border-white text-gray-300 py-3 rounded-xl font-bold text-xs uppercase transition">Cancelar</button>
                    <button 
                        onClick={() => onConfirm(selectedPlanId, selectedDisciplineId)} 
                        disabled={!selectedDisciplineId}
                        className="flex-1 bg-insanus-red hover:bg-red-600 text-white py-3 rounded-xl font-bold text-xs uppercase shadow-neon transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Confirmar Cópia
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- MAIN DASHBOARD COMPONENT ---

interface AdminDashboardProps {
    user: User;
    onSwitchToUser: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, onSwitchToUser }) => {
    // RBAC PERMISSION CHECK
    const hasPerm = (perm: string) => {
        // Master Admin Email (Hardcoded safety) or 'master_access' permission or empty permissions (Legacy Admin)
        if (user.email === ADMIN_EMAIL || user.permissions?.includes('master_access') || !user.permissions) return true;
        return user.permissions.includes(perm);
    };

    // Determine initial active tab based on permissions
    const getInitialTab = () => {
        if (hasPerm('plans_access')) return 'plans';
        if (hasPerm('users_access')) return 'users';
        if (hasPerm('simulados_access')) return 'simulados';
        return 'plans'; // Fallback
    };

    const [activeTab, setActiveTab] = useState<'plans' | 'users' | 'simulados' | 'maintenance' | 'team'>(getInitialTab());
    const [plans, setPlans] = useState<StudyPlan[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [simuladoClasses, setSimuladoClasses] = useState<SimuladoClass[]>([]);
    const [categories, setCategories] = useState<CategoryDefinition[]>([]);
    
    // Editors State
    const [editingPlan, setEditingPlan] = useState<StudyPlan | null>(null);
    const [editingSimClass, setEditingSimClass] = useState<SimuladoClass | null>(null);

    // User Management State
    const [userSearch, setUserSearch] = useState('');
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [showUserModal, setShowUserModal] = useState(false);
    const [showEmbedModal, setShowEmbedModal] = useState(false);
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    
    // Team Management State
    const [showCollaboratorModal, setShowCollaboratorModal] = useState(false);

    // Filters for Plans
    const [filterCategory, setFilterCategory] = useState('');
    const [filterSubCategory, setFilterSubCategory] = useState('');
    const [filterOrganization, setFilterOrganization] = useState(''); // NEW

    // Filters for Simulados (NEW)
    const [filterSimCategory, setFilterSimCategory] = useState('');
    const [filterSimSubCategory, setFilterSimSubCategory] = useState('');
    const [filterSimOrganization, setFilterSimOrganization] = useState(''); // NEW

    // NEW: User Management Filters
    const [filterUserPlan, setFilterUserPlan] = useState('');
    const [filterUserSimulado, setFilterUserSimulado] = useState('');
    const [filterUserStatus, setFilterUserStatus] = useState(''); // '' | 'active' | 'expired'

    // CONFIRMATION MODAL STATE
    const [confirmAction, setConfirmAction] = useState<{ 
        open: boolean; 
        title: string; 
        desc: string; 
        action: () => void; 
        isDestructive?: boolean 
    } | null>(null);

    // WARNING MODAL STATE (Security Block)
    const [warningModal, setWarningModal] = useState<{ 
        isOpen: boolean; 
        title: string; 
        message: string; 
    } | null>(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        const promises = [];
        if (hasPerm('plans_access')) promises.push(fetchPlansFromDB()); else promises.push(Promise.resolve([]));
        if (hasPerm('users_access') || hasPerm('master_access')) promises.push(fetchUsersFromDB()); else promises.push(Promise.resolve([]));
        if (hasPerm('simulados_access')) promises.push(fetchSimuladoClassesFromDB()); else promises.push(Promise.resolve([]));
        promises.push(fetchCategoryConfig());

        const [p, u, s, c] = await Promise.all(promises);
        setPlans(p);
        setUsers(u);
        setSimuladoClasses(s);
        setCategories(c);
    };

    const handleCreatePlan = async () => {
        const newPlan: StudyPlan = {
            id: uuid(),
            name: 'Novo Plano de Estudos',
            category: 'OUTROS',
            coverImage: '',
            folders: [],
            disciplines: [],
            cycles: [],
            cycleSystem: 'continuo',
            editalVerticalizado: [],
            linkedContests: [],
            createdAt: new Date().toISOString()
        };
        await savePlanToDB(newPlan);
        await loadData();
        setEditingPlan(newPlan);
    };

    const handleSavePlan = async (updatedPlan: StudyPlan) => {
        await savePlanToDB(updatedPlan);
        setPlans(prev => prev.map(p => p.id === updatedPlan.id ? updatedPlan : p));
        setEditingPlan(updatedPlan);
    };

    const handleDeletePlan = (id: string) => {
        // SECURITY CHECK: PREVENT DELETION IF USERS ARE ACTIVE
        const activeUsers = users.filter(u => u.allowedPlans && u.allowedPlans.includes(id));
        if (activeUsers.length > 0) {
            setWarningModal({
                isOpen: true,
                title: "Exclusão Bloqueada",
                message: `Não é possível excluir este plano.\n\nExistem ${activeUsers.length} alunos com acesso ativo a ele.\n\nRemova o acesso dos alunos antes de excluir.`
            });
            return;
        }

        setConfirmAction({
            open: true,
            title: "Excluir Plano",
            desc: "Tem certeza que deseja excluir este plano permanentemente? Esta ação não pode ser desfeita.",
            isDestructive: true,
            action: async () => {
                await deletePlanFromDB(id);
                await loadData();
                if (editingPlan?.id === id) setEditingPlan(null);
                setConfirmAction(null);
            }
        });
    };

    const handleDuplicatePlan = (plan: StudyPlan) => {
        setConfirmAction({
            open: true,
            title: "Duplicar Plano",
            desc: `Deseja criar uma cópia do plano "${plan.name}"?`,
            isDestructive: false,
            action: async () => {
                const newPlan = { ...plan, id: uuid(), name: `${plan.name} (Cópia)`, createdAt: new Date().toISOString() };
                await savePlanToDB(newPlan);
                await loadData();
                setConfirmAction(null);
            }
        });
    };

    const handleCreateSimClass = async () => {
        const newClass: SimuladoClass = { id: uuid(), name: 'Nova Turma de Simulados', simulados: [], createdAt: new Date().toISOString() };
        await saveSimuladoClassToDB(newClass);
        loadData();
        setEditingSimClass(newClass);
    };

    const handleDeleteSimClass = (id: string) => {
        // SECURITY CHECK: PREVENT DELETION IF USERS ARE ACTIVE
        const activeUsers = users.filter(u => u.allowedSimuladoClasses && u.allowedSimuladoClasses.includes(id));
        if (activeUsers.length > 0) {
            setWarningModal({
                isOpen: true,
                title: "Exclusão Bloqueada",
                message: `Não é possível excluir esta turma de simulados.\n\nExistem ${activeUsers.length} alunos com acesso ativo a ela.\n\nRemova o acesso dos alunos antes de excluir.`
            });
            return;
        }

        setConfirmAction({
            open: true,
            title: "Excluir Turma",
            desc: "Excluir esta turma de simulados? Todos os simulados vinculados serão removidos.",
            isDestructive: true,
            action: async () => {
                await deleteSimuladoClassFromDB(id);
                loadData();
                setConfirmAction(null);
            }
        });
    }

    const handleDuplicateSimClass = (sc: SimuladoClass) => {
        setConfirmAction({
            open: true,
            title: "Duplicar Turma",
            desc: `Criar uma cópia da turma "${sc.name}"?`,
            isDestructive: false,
            action: async () => {
                const newClass = { ...sc, id: uuid(), name: `${sc.name} (Cópia)`, createdAt: new Date().toISOString() };
                await saveSimuladoClassToDB(newClass);
                loadData();
                setConfirmAction(null);
            }
        });
    }

    const handleDeleteUser = (userId: string) => {
        setConfirmAction({
            open: true,
            title: "Excluir Aluno",
            desc: "Deseja realmente excluir este usuário? Esta ação é irreversível.",
            isDestructive: true,
            action: async () => {
                try {
                    await deleteUserFromDB(userId);
                    setUsers(users.filter(u => u.id !== userId));
                } catch (e) {
                    alert("Erro ao excluir usuário.");
                }
                setConfirmAction(null);
            }
        });
    }

    const handleSaveUser = async (u: User) => {
        try {
            await saveUserToDB(u);
            setShowUserModal(false);
            setEditingUser(null);
            loadData();
        } catch (e) {
            alert("Erro ao salvar usuário.");
        }
    }

    const handleSaveCategories = async (newCats: CategoryDefinition[]) => {
        await saveCategoryConfig(newCats);
        setCategories(newCats);
    }

    const handleCreateCollaborator = async (name: string, username: string, pass: string, perms: string[]) => {
        await createCollaborator(name, username, pass, perms);
        await loadData();
        alert("Colaborador criado com sucesso!");
    };

    // Filter Logic for Plans
    const filteredPlans = plans.filter(p => {
        if (filterCategory && p.category !== filterCategory) return false;
        if (filterSubCategory && p.subCategory !== filterSubCategory) return false;
        if (filterOrganization && !p.organization?.toUpperCase().includes(filterOrganization.toUpperCase())) return false; // NEW
        return true;
    }).sort((a, b) => {
        // Sort by creation date new to old
        const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return db - da;
    });

    const activeCategoryDef = categories.find(c => c.name === filterCategory);

    // Filter Logic for Simulados (NEW)
    const filteredSimulados = simuladoClasses.filter(s => {
        if (filterSimCategory && s.category !== filterSimCategory) return false;
        if (filterSimSubCategory && s.subCategory !== filterSimSubCategory) return false;
        if (filterSimOrganization && !s.organization?.toUpperCase().includes(filterSimOrganization.toUpperCase())) return false; // NEW
        return true;
    }).sort((a, b) => {
        const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return db - da;
    });

    const activeSimCategoryDef = categories.find(c => c.name === filterSimCategory);

    if (editingPlan) {
        return <PlanDetailEditor plan={editingPlan} allPlans={plans} categories={categories} onUpdate={setEditingPlan} onSave={handleSavePlan} onBack={() => { setEditingPlan(null); loadData(); }} />;
    }

    if (editingSimClass) {
        return <SimuladoEditor simClass={editingSimClass} categories={categories} onUpdate={setEditingSimClass} onBack={() => { setEditingSimClass(null); loadData(); }} />;
    }

    return (
        <div className="w-full h-full flex flex-col bg-[#050505] text-white">
            <div className="h-14 border-b border-[#333] bg-[#0F0F0F] flex items-center px-8 gap-8 shrink-0">
                <div className="flex items-center gap-2 mr-8">
                    <div className="w-8 h-8 bg-insanus-red rounded-full flex items-center justify-center shadow-neon font-black text-xs">AD</div>
                    <div>
                        <div className="text-[10px] font-bold text-gray-500 uppercase">Administrador</div>
                        <div className="font-bold text-sm">Painel de Controle</div>
                    </div>
                </div>
                <div className="flex gap-6 flex-1">
                    {hasPerm('plans_access') && (
                        <button onClick={() => setActiveTab('plans')} className={`text-xs font-bold uppercase py-4 border-b-2 transition ${activeTab === 'plans' ? 'text-white border-insanus-red' : 'text-gray-500 border-transparent'}`}>Planos</button>
                    )}
                    {hasPerm('users_access') && (
                        <button onClick={() => setActiveTab('users')} className={`text-xs font-bold uppercase py-4 border-b-2 transition ${activeTab === 'users' ? 'text-white border-insanus-red' : 'text-gray-500 border-transparent'}`}>Alunos</button>
                    )}
                    {hasPerm('simulados_access') && (
                        <button onClick={() => setActiveTab('simulados')} className={`text-xs font-bold uppercase py-4 border-b-2 transition ${activeTab === 'simulados' ? 'text-white border-insanus-red' : 'text-gray-500 border-transparent'}`}>Simulados</button>
                    )}
                    {hasPerm('master_access') && (
                        <>
                            <button onClick={() => setActiveTab('team')} className={`text-xs font-bold uppercase py-4 border-b-2 transition ${activeTab === 'team' ? 'text-white border-blue-500' : 'text-gray-500 border-transparent'}`}>Equipe</button>
                            <button onClick={() => setActiveTab('maintenance')} className={`text-xs font-bold uppercase py-4 border-b-2 transition ${activeTab === 'maintenance' ? 'text-white border-insanus-red' : 'text-gray-500 border-transparent'}`}>Manutenção</button>
                        </>
                    )}
                </div>
                <div className="flex gap-2">
                    <button onClick={() => setShowEmbedModal(true)} className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-[#333] hover:bg-white/5 text-gray-500 hover:text-white font-bold text-[10px] uppercase transition"><Icon.Code className="w-3 h-3"/> Embed</button>
                    <button onClick={onSwitchToUser} className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-[#333] hover:bg-white/5 text-gray-500 hover:text-white font-bold text-[10px] uppercase transition"><Icon.Eye className="w-3 h-3"/> Aluno</button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                {activeTab === 'maintenance' && hasPerm('master_access') && <MaintenanceView currentUser={user} />}
                
                {activeTab === 'team' && hasPerm('master_access') && (
                    <div className="animate-fade-in">
                        <div className="flex flex-col gap-4 mb-8">
                            <div className="flex justify-between items-center">
                                <h2 className="text-3xl font-black text-white uppercase tracking-tight">Gestão da Equipe</h2>
                                <button onClick={() => setShowCollaboratorModal(true)} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-xl font-black text-xs uppercase shadow-neon transition transform hover:scale-[1.02]">+ Novo Colaborador</button>
                            </div>
                        </div>
                        <div className="bg-[#121212] border border-[#333] rounded-2xl overflow-hidden">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-[#1A1A1A] text-[10px] text-gray-500 font-bold uppercase tracking-widest border-b border-[#333]">
                                    <tr>
                                        <th className="p-4">Nome</th>
                                        <th className="p-4">Usuário / E-mail</th>
                                        <th className="p-4">Permissões</th>
                                        <th className="p-4 text-right">Ações</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#222]">
                                    {users.filter(u => u.isAdmin && u.email !== ADMIN_EMAIL).map(u => (
                                        <tr key={u.id} className="hover:bg-white/5 transition">
                                            <td className="p-4 text-sm font-bold text-white">{u.name}</td>
                                            <td className="p-4 text-sm text-gray-400">
                                                {u.email.includes('@staff.insanus') ? (
                                                    <span className="text-blue-400 font-mono font-bold bg-blue-900/20 px-2 py-1 rounded">@{u.email.split('@')[0]}</span>
                                                ) : u.email}
                                            </td>
                                            <td className="p-4">
                                                <div className="flex gap-1 flex-wrap">
                                                    {u.permissions?.map(p => (
                                                        <span key={p} className="text-[9px] font-bold bg-white/5 border border-white/10 px-2 py-1 rounded uppercase text-gray-300">
                                                            {p.replace('_access', '').replace('master', 'TOTAL')}
                                                        </span>
                                                    ))}
                                                    {!u.permissions && <span className="text-[9px] text-gray-600 italic">Legado (Total)</span>}
                                                </div>
                                            </td>
                                            <td className="p-4 text-right">
                                                <button onClick={() => handleDeleteUser(u.id)} className="text-red-500 hover:text-red-400 font-bold text-[10px] uppercase">Excluir</button>
                                            </td>
                                        </tr>
                                    ))}
                                    {users.filter(u => u.isAdmin && u.email !== ADMIN_EMAIL).length === 0 && (
                                        <tr>
                                            <td colSpan={4} className="p-8 text-center text-gray-600 text-sm italic">Nenhum colaborador cadastrado.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {activeTab === 'simulados' && hasPerm('simulados_access') && (
                    <div className="space-y-6">
                        <div className="flex justify-between items-center">
                            <h2 className="text-3xl font-black text-white uppercase tracking-tight">Turmas de Simulados</h2>
                            <div className="flex gap-3">
                                <button onClick={() => setShowCategoryModal(true)} className="bg-[#1E1E1E] border border-[#333] hover:border-gray-500 text-gray-300 hover:text-white px-4 py-3 rounded-xl font-bold text-xs uppercase transition">
                                    Gerenciar Categorias
                                </button>
                                <button onClick={handleCreateSimClass} className="bg-insanus-red hover:bg-red-600 text-white px-6 py-3 rounded-xl font-black text-xs uppercase shadow-neon transition transform hover:scale-[1.02]">
                                    + Nova Turma
                                </button>
                            </div>
                        </div>

                        {/* FILTER BAR FOR SIMULADOS */}
                        <div className="bg-[#121212] border border-[#333] p-4 rounded-xl flex flex-wrap gap-4 items-center">
                            <div className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase">
                                <Icon.Search className="w-4 h-4"/> Filtros:
                            </div>
                            <select 
                                value={filterSimCategory} 
                                onChange={e => { setFilterSimCategory(e.target.value); setFilterSimSubCategory(''); }} 
                                className="bg-black/40 border border-[#333] rounded px-3 py-2 text-xs text-white outline-none focus:border-insanus-red uppercase"
                            >
                                <option value="">Todas as Categorias</option>
                                {categories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                            </select>
                            
                            <select 
                                value={filterSimSubCategory} 
                                onChange={e => setFilterSimSubCategory(e.target.value)} 
                                className="bg-black/40 border border-[#333] rounded px-3 py-2 text-xs text-white outline-none focus:border-insanus-red uppercase disabled:opacity-50"
                                disabled={!filterSimCategory}
                            >
                                <option value="">Todas as Subcategorias</option>
                                {activeSimCategoryDef?.subCategories.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>

                            <input 
                                type="text" 
                                placeholder="FILTRAR POR ÓRGÃO..." 
                                value={filterSimOrganization}
                                onChange={(e) => setFilterSimOrganization(e.target.value)}
                                className="bg-black/40 border border-[#333] rounded px-3 py-2 text-xs text-white outline-none focus:border-insanus-red uppercase w-40"
                            />

                            {(filterSimCategory || filterSimSubCategory || filterSimOrganization) && (
                                <button onClick={() => { setFilterSimCategory(''); setFilterSimSubCategory(''); setFilterSimOrganization(''); }} className="text-[10px] text-red-500 hover:underline uppercase font-bold ml-auto">
                                    Limpar Filtros
                                </button>
                            )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {filteredSimulados.map(sc => (
                                <div key={sc.id} className="bg-[#121212] border border-[#333] rounded-2xl overflow-hidden hover:border-gray-600 transition group flex flex-col">
                                    <div className="aspect-square bg-gray-800 relative">
                                        {sc.coverImage ? <img src={sc.coverImage} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-gray-600"><Icon.Image className="w-10 h-10"/></div>}
                                        <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                                            {sc.category && <span className="bg-black/60 backdrop-blur text-white text-[9px] font-bold px-2 py-1 rounded uppercase border border-white/10">{sc.category}</span>}
                                            {sc.subCategory && <span className="bg-insanus-red/80 backdrop-blur text-white text-[8px] font-bold px-2 py-1 rounded uppercase shadow-sm">{sc.subCategory}</span>}
                                            {sc.organization && <span className="bg-blue-600/80 backdrop-blur text-white text-[8px] font-bold px-2 py-1 rounded uppercase shadow-sm border border-blue-500/20">{sc.organization}</span>}
                                        </div>
                                    </div>
                                    <div className="p-4 flex-1 flex flex-col">
                                        <h3 className="font-bold text-lg text-white mb-1 line-clamp-2">{sc.name}</h3>
                                        <p className="text-gray-500 text-xs mb-4">{sc.simulados.length} simulados cadastrados</p>
                                        <div className="mt-auto flex gap-2">
                                            <button onClick={() => setEditingSimClass(sc)} className="flex-1 bg-white/5 hover:bg-white/10 text-white py-2 rounded-lg font-bold text-xs uppercase border border-white/10 transition">Gerenciar</button>
                                            <button onClick={() => handleDuplicateSimClass(sc)} className="p-2 text-gray-600 hover:text-white transition bg-white/5 rounded-lg border border-white/5" title="Duplicar"><Icon.Copy className="w-4 h-4"/></button>
                                            <button onClick={() => handleDeleteSimClass(sc.id)} className="p-2 text-gray-600 hover:text-red-500 transition bg-white/5 rounded-lg border border-white/5"><Icon.Trash className="w-4 h-4"/></button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {filteredSimulados.length === 0 && (
                                <div className="col-span-full text-center py-20 border border-dashed border-[#333] rounded-xl text-gray-500 italic">
                                    Nenhuma turma encontrada com os filtros selecionados.
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'plans' && hasPerm('plans_access') && (
                    <div className="animate-fade-in">
                        <div className="flex flex-col gap-6 mb-8">
                            <div className="flex justify-between items-center">
                                <h2 className="text-3xl font-black text-white uppercase tracking-tight">Planos de Estudo</h2>
                                <div className="flex gap-3">
                                    <button onClick={() => setShowCategoryModal(true)} className="bg-[#1E1E1E] border border-[#333] hover:border-gray-500 text-gray-300 hover:text-white px-4 py-3 rounded-xl font-bold text-xs uppercase transition">
                                        Gerenciar Categorias
                                    </button>
                                    <button onClick={handleCreatePlan} className="bg-insanus-red hover:bg-red-600 text-white px-6 py-3 rounded-xl font-black text-xs uppercase shadow-neon transition transform hover:scale-[1.02]">
                                        + Novo Plano
                                    </button>
                                </div>
                            </div>
                            
                            {/* FILTER BAR */}
                            <div className="bg-[#121212] border border-[#333] p-4 rounded-xl flex flex-wrap gap-4 items-center">
                                <div className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase">
                                    <Icon.Search className="w-4 h-4"/> Filtros:
                                </div>
                                <select 
                                    value={filterCategory} 
                                    onChange={e => { setFilterCategory(e.target.value); setFilterSubCategory(''); }} 
                                    className="bg-black/40 border border-[#333] rounded px-3 py-2 text-xs text-white outline-none focus:border-insanus-red uppercase"
                                >
                                    <option value="">Todas as Categorias</option>
                                    {categories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                                </select>
                                
                                <select 
                                    value={filterSubCategory} 
                                    onChange={e => setFilterSubCategory(e.target.value)} 
                                    className="bg-black/40 border border-[#333] rounded px-3 py-2 text-xs text-white outline-none focus:border-insanus-red uppercase disabled:opacity-50"
                                    disabled={!filterCategory}
                                >
                                    <option value="">Todas as Subcategorias</option>
                                    {activeCategoryDef?.subCategories.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>

                                <input 
                                    type="text" 
                                    placeholder="FILTRAR POR ÓRGÃO..." 
                                    value={filterOrganization}
                                    onChange={(e) => setFilterOrganization(e.target.value)}
                                    className="bg-black/40 border border-[#333] rounded px-3 py-2 text-xs text-white outline-none focus:border-insanus-red uppercase w-40"
                                />

                                {(filterCategory || filterSubCategory || filterOrganization) && (
                                    <button onClick={() => { setFilterCategory(''); setFilterSubCategory(''); setFilterOrganization(''); }} className="text-[10px] text-red-500 hover:underline uppercase font-bold ml-auto">
                                        Limpar Filtros
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {filteredPlans.map(plan => (
                                <div key={plan.id} className="bg-[#121212] border border-[#333] rounded-2xl overflow-hidden hover:border-gray-600 transition group flex flex-col">
                                    <div className="aspect-square bg-gray-800 relative">
                                        {plan.coverImage ? <img src={plan.coverImage} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-gray-600"><Icon.Image className="w-10 h-10"/></div>}
                                        <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                                            <span className="bg-black/60 backdrop-blur text-white text-[9px] font-bold px-2 py-1 rounded uppercase border border-white/10">{plan.category}</span>
                                            {plan.subCategory && <span className="bg-insanus-red/80 backdrop-blur text-white text-[8px] font-bold px-2 py-1 rounded uppercase shadow-sm">{plan.subCategory}</span>}
                                            {plan.organization && <span className="bg-blue-600/80 backdrop-blur text-white text-[8px] font-bold px-2 py-1 rounded uppercase shadow-sm border border-blue-500/20">{plan.organization}</span>}
                                        </div>
                                    </div>
                                    <div className="p-4 flex-1 flex flex-col">
                                        <h3 className="font-bold text-lg text-white mb-1 line-clamp-2">{plan.name}</h3>
                                        <p className="text-gray-500 text-xs mb-4">{plan.disciplines.length} Disciplinas • {plan.cycles.length} Ciclos</p>
                                        <div className="mt-auto flex gap-2">
                                            <button onClick={() => setEditingPlan(plan)} className="flex-1 bg-white/5 hover:bg-white/10 text-white py-2 rounded-lg font-bold text-xs uppercase border border-white/10 transition">Editar</button>
                                            <button onClick={() => handleDuplicatePlan(plan)} className="p-2 text-gray-600 hover:text-white transition bg-white/5 rounded-lg border border-white/5" title="Duplicar"><Icon.Copy className="w-4 h-4"/></button>
                                            <button onClick={() => handleDeletePlan(plan.id)} className="p-2 text-gray-600 hover:text-red-500 transition bg-white/5 rounded-lg border border-white/5"><Icon.Trash className="w-4 h-4"/></button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {filteredPlans.length === 0 && (
                                <div className="col-span-full text-center py-20 border border-dashed border-[#333] rounded-xl text-gray-500 italic">
                                    Nenhum plano encontrado com os filtros selecionados.
                                </div>
                            )}
                        </div>
                    </div>
                )}
                
                {activeTab === 'users' && hasPerm('users_access') && (
                    <div className="animate-fade-in">
                        <div className="flex flex-col gap-4 mb-8">
                            <div className="flex justify-between items-center">
                                <h2 className="text-3xl font-black text-white uppercase tracking-tight">Alunos Matriculados</h2>
                                <div className="flex gap-4">
                                    <div className="bg-[#121212] border border-[#333] rounded-lg px-3 py-2 flex items-center gap-2 text-gray-400">
                                        <Icon.User className="w-4 h-4"/>
                                        <span className="text-xs font-mono font-bold">{users.filter(u => !u.isAdmin).length} Alunos</span>
                                    </div>
                                    <button onClick={() => { 
                                        setEditingUser(null); 
                                        setShowUserModal(true); 
                                    }} className="bg-insanus-red hover:bg-red-600 text-white px-6 py-2 rounded-xl font-black text-xs uppercase shadow-neon transition transform hover:scale-[1.02]">+ Novo Aluno</button>
                                </div>
                            </div>
                            
                            {/* NEW: USER FILTERS */}
                            <div className="bg-[#121212] border border-[#333] p-4 rounded-xl flex flex-wrap gap-4 items-center">
                                <div className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase">
                                    <Icon.Search className="w-4 h-4"/> Filtros:
                                </div>
                                
                                <select 
                                    value={filterUserPlan} 
                                    onChange={(e) => { setFilterUserPlan(e.target.value); setFilterUserSimulado(''); }} 
                                    className="bg-black/40 border border-[#333] rounded px-3 py-2 text-xs text-white outline-none focus:border-insanus-red uppercase max-w-[200px]"
                                >
                                    <option value="">Todos os Planos</option>
                                    {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>

                                <select 
                                    value={filterUserSimulado} 
                                    onChange={(e) => { setFilterUserSimulado(e.target.value); setFilterUserPlan(''); }} 
                                    className="bg-black/40 border border-[#333] rounded px-3 py-2 text-xs text-white outline-none focus:border-insanus-red uppercase max-w-[200px]"
                                >
                                    <option value="">Todas as Turmas</option>
                                    {simuladoClasses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>

                                <select 
                                    value={filterUserStatus} 
                                    onChange={(e) => setFilterUserStatus(e.target.value)} 
                                    className="bg-black/40 border border-[#333] rounded px-3 py-2 text-xs text-white outline-none focus:border-insanus-red uppercase disabled:opacity-50"
                                    disabled={!filterUserPlan && !filterUserSimulado}
                                >
                                    <option value="">Todos Status</option>
                                    <option value="active">Ativos</option>
                                    <option value="expired">Expirados</option>
                                </select>

                                <input 
                                    type="text" 
                                    placeholder="Buscar por nome, e-mail ou CPF..." 
                                    value={userSearch}
                                    onChange={(e) => setUserSearch(e.target.value)}
                                    className="bg-black/40 border border-[#333] rounded px-3 py-2 text-xs text-white outline-none focus:border-insanus-red uppercase flex-1 min-w-[200px]"
                                />

                                {(filterUserPlan || filterUserSimulado || filterUserStatus || userSearch) && (
                                    <button onClick={() => { setFilterUserPlan(''); setFilterUserSimulado(''); setFilterUserStatus(''); setUserSearch(''); }} className="text-[10px] text-red-500 hover:underline uppercase font-bold ml-auto">
                                        Limpar Filtros
                                    </button>
                                )}
                            </div>

                        </div>
                        <div className="bg-[#121212] border border-[#333] rounded-2xl overflow-hidden">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-[#1A1A1A] text-[10px] text-gray-500 font-bold uppercase tracking-widest border-b border-[#333]">
                                    <tr>
                                        <th className="p-4">Nome</th>
                                        <th className="p-4">Email</th>
                                        <th className="p-4">CPF</th>
                                        <th className="p-4">Cadastro</th>
                                        {(filterUserPlan || filterUserSimulado) ? (
                                            <th className="p-4">Vencimento</th>
                                        ) : (
                                            <th className="p-4">Planos</th>
                                        )}
                                        <th className="p-4 text-right">Ações</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#222]">
                                    {users.filter(u => {
                                        if (u.isAdmin) return false;
                                        
                                        // Text Search
                                        const searchMatch = 
                                            u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
                                            u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
                                            u.cpf.includes(userSearch);
                                        if (!searchMatch) return false;

                                        // Plan Filter
                                        if (filterUserPlan && !u.allowedPlans.includes(filterUserPlan)) return false;

                                        // Simulado Class Filter
                                        if (filterUserSimulado && !u.allowedSimuladoClasses?.includes(filterUserSimulado)) return false;

                                        // Status Filter
                                        if (filterUserStatus) {
                                            let days = 999;
                                            if (filterUserPlan) {
                                                const expDate = u.planExpirations?.[filterUserPlan];
                                                days = getDaysDiff(expDate);
                                            } else if (filterUserSimulado) {
                                                const expDate = u.simuladoExpirations?.[filterUserSimulado];
                                                days = getDaysDiff(expDate);
                                            }
                                            
                                            if (filterUserStatus === 'active' && days <= 0) return false;
                                            if (filterUserStatus === 'expired' && days > 0) return false;
                                        }

                                        return true;
                                    }).map(u => {
                                        let statusCell = null;
                                        if (filterUserPlan) {
                                            const expDate = u.planExpirations?.[filterUserPlan];
                                            const startDate = u.planConfigs?.[filterUserPlan]?.startDate;
                                            const days = getDaysDiff(expDate);
                                            const isExpired = days <= 0;
                                            statusCell = (
                                                <div className="flex flex-col">
                                                    <span className={`text-xs font-bold ${isExpired ? 'text-red-500' : 'text-green-500'}`}>
                                                        {isExpired ? 'EXPIRADO' : 'ATIVO'}
                                                    </span>
                                                    <span className="text-[9px] text-gray-500 font-mono">
                                                        Venc: {expDate ? new Date(expDate).toLocaleDateString('pt-BR') : 'Vitalício'}
                                                    </span>
                                                    {startDate && (
                                                        <span className="text-[8px] text-gray-600 font-mono">
                                                            Início: {new Date(startDate).toLocaleDateString('pt-BR')}
                                                        </span>
                                                    )}
                                                </div>
                                            );
                                        } else if (filterUserSimulado) {
                                            const expDate = u.simuladoExpirations?.[filterUserSimulado];
                                            const days = getDaysDiff(expDate);
                                            const isExpired = days <= 0;
                                            statusCell = (
                                                <div className="flex flex-col">
                                                    <span className={`text-xs font-bold ${isExpired ? 'text-red-500' : 'text-green-500'}`}>
                                                        {isExpired ? 'EXPIRADO' : 'ATIVO'}
                                                    </span>
                                                    <span className="text-[9px] text-gray-500 font-mono">
                                                        Venc: {expDate ? new Date(expDate).toLocaleDateString('pt-BR') : 'Vitalício'}
                                                    </span>
                                                </div>
                                            );
                                        } else {
                                            statusCell = <span className="text-xs text-gray-500">{u.allowedPlans.length} planos</span>;
                                        }

                                        return (
                                            <tr key={u.id} className="hover:bg-white/5 transition group">
                                                <td className="p-4 text-sm font-bold text-white">{u.name}</td>
                                                <td className="p-4 text-sm text-gray-400">{u.email}</td>
                                                <td className="p-4 text-xs font-mono text-gray-500">{u.cpf}</td>
                                                <td className="p-4 text-xs font-mono text-gray-400">
                                                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString('pt-BR') : '--/--/----'}
                                                </td>
                                                <td className="p-4">
                                                    {statusCell}
                                                </td>
                                                <td className="p-4 text-right flex justify-end gap-2 opacity-60 group-hover:opacity-100">
                                                    <button onClick={() => { setEditingUser(u); setShowUserModal(true); }} className="text-blue-500 hover:text-blue-400 font-bold text-[10px] uppercase">Editar</button>
                                                    <button onClick={() => handleDeleteUser(u.id)} className="text-red-500 hover:text-red-400 font-bold text-[10px] uppercase ml-2">Excluir</button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {users.filter(u => !u.isAdmin && (u.name.toLowerCase().includes(userSearch.toLowerCase()) || u.email.toLowerCase().includes(userSearch.toLowerCase()) || u.cpf.includes(userSearch))).length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="p-8 text-center text-gray-600 text-sm italic">Nenhum aluno encontrado com os filtros selecionados.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {showUserModal && (
                <UserFormModal 
                    initialUser={editingUser} 
                    allPlans={plans} 
                    allSimuladoClasses={simuladoClasses}
                    existingUsers={users}
                    onSave={handleSaveUser} 
                    onCancel={() => { setShowUserModal(false); setEditingUser(null); }} 
                />
            )}

            {showCategoryModal && (
                <CategoryManagerModal 
                    categories={categories}
                    onSave={handleSaveCategories}
                    onClose={() => setShowCategoryModal(false)}
                />
            )}

            {/* NEW: COLLABORATOR MODAL */}
            {showCollaboratorModal && (
                <CollaboratorModal
                    onSave={handleCreateCollaborator}
                    onClose={() => setShowCollaboratorModal(false)}
                />
            )}

            {showEmbedModal && <EmbedModal onClose={() => setShowEmbedModal(false)} />}

            {/* Confirmation Modal */}
            {confirmAction && confirmAction.open && (
                <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-[#121212] border border-[#333] p-6 rounded-2xl w-full max-w-sm shadow-2xl relative overflow-hidden">
                        {confirmAction.isDestructive && <div className="absolute top-0 left-0 w-full h-1 bg-red-600"></div>}
                        <h3 className="text-xl font-black text-white uppercase mb-2">{confirmAction.title}</h3>
                        <p className="text-gray-400 text-sm mb-6">{confirmAction.desc}</p>
                        <div className="flex gap-3">
                            <button onClick={() => setConfirmAction(null)} className="flex-1 bg-white/5 hover:bg-white/10 text-white py-3 rounded-xl font-bold text-xs uppercase border border-white/10 transition">Cancelar</button>
                            <button onClick={confirmAction.action} className={`flex-1 text-white py-3 rounded-xl font-bold text-xs uppercase shadow-neon transition ${confirmAction.isDestructive ? 'bg-red-600 hover:bg-red-500' : 'bg-insanus-red hover:bg-red-600'}`}>Confirmar</button>
                        </div>
                    </div>
                </div>
            )}

            {/* NEW: WARNING POPUP (Security Check) */}
            {warningModal && warningModal.isOpen && (
                <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-[#121212] border border-red-500/50 p-6 rounded-2xl w-full max-w-sm shadow-[0_0_40px_rgba(239,68,68,0.2)] relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-red-600"></div>
                        <div className="flex flex-col items-center text-center">
                            <div className="w-16 h-16 bg-red-900/10 rounded-full flex items-center justify-center mb-4 border border-red-500/20">
                                <Icon.EyeOff className="w-8 h-8 text-red-500" />
                            </div>
                            <h3 className="text-xl font-black text-white uppercase mb-2 tracking-tight">{warningModal.title}</h3>
                            <p className="text-gray-400 text-sm mb-6 whitespace-pre-line leading-relaxed">{warningModal.message}</p>
                            <button 
                                onClick={() => setWarningModal(null)} 
                                className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white py-3 rounded-xl font-bold text-xs uppercase transition hover:border-white/30"
                            >
                                Entendido
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
