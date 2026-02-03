import React, { useState, useEffect, useRef } from 'react';
import { 
    Goal, SubGoal, Flashcard, MindMapNode, SimuladoClass, Simulado, 
    User, StudyPlan, Folder, Discipline, Subject, PlanCategory, 
    SimuladoBlock, SimuladoQuestionConfig, Cycle, CycleItem,
    EditalDiscipline, EditalTopic, EditalSubTopic, GoalFile,
    GoalLink, GoalType
} from '../types';
import { Icon } from '../components/Icons';
import { uuid } from '../constants';
import { uploadFileToStorage } from '../services/storage';
import { 
    saveSimuladoClassToDB, fetchSimuladoClassesFromDB, fetchPlansFromDB, 
    savePlanToDB, fetchUsersFromDB, saveUserToDB, deletePlanFromDB, 
    deleteUserFromDB, deleteSimuladoClassFromDB,
    createCloudSnapshot, getCloudSnapshots, deleteCloudSnapshot, restoreFromCloudSnapshot,
    exportFullDatabase, importFullDatabase, DatabaseBackup, CloudBackup
} from '../services/db';
import { generateFlashcardsFromPDF, generateMindMapFromFiles } from '../services/ai';
import { VisualMindMapModal } from '../components/MindMapEditor';

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
    return (
        <div className="ml-6 border-l border-[#333] pl-2 mt-2">
            <div className="flex items-center gap-2 mb-2">
                <input value={sub.name} onChange={e => onUpdate({...sub, name: e.target.value})} className="bg-transparent text-xs text-gray-400 focus:text-white border-b border-transparent focus:border-white/20 outline-none w-full" placeholder="Nome do Subtópico"/>
                <div className="flex items-center gap-1">
                    <button onClick={() => onMove('up')} disabled={isFirst} className="text-gray-600 hover:text-white disabled:opacity-20"><Icon.ArrowUp className="w-3 h-3"/></button>
                    <button onClick={() => onMove('down')} disabled={isLast} className="text-gray-600 hover:text-white disabled:opacity-20"><Icon.ArrowDown className="w-3 h-3"/></button>
                </div>
                <button onClick={onDelete} className="text-gray-600 hover:text-red-500 ml-1"><Icon.Trash className="w-3 h-3"/></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
                {['aula','material','questoes','leiSeca','resumo','revisao'].map(key => (
                    <div key={key} className="flex flex-col">
                        <label className="text-[8px] text-gray-600 uppercase font-bold">{key}</label>
                        <LinkSelector plan={plan} value={sub.links[key as keyof typeof sub.links]} onChange={v => onUpdate({...sub, links: {...sub.links, [key]: v}})} />
                    </div>
                ))}
            </div>
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

// --- MAIN DASHBOARD COMPONENT ---

interface AdminDashboardProps {
    user: User;
    onSwitchToUser: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, onSwitchToUser }) => {
    const [activeTab, setActiveTab] = useState<'plans' | 'users' | 'simulados' | 'maintenance'>('plans');
    const [plans, setPlans] = useState<StudyPlan[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [simuladoClasses, setSimuladoClasses] = useState<SimuladoClass[]>([]);
    
    // Editors State
    const [editingSimClass, setEditingSimClass] = useState<SimuladoClass | null>(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        const [p, u, s] = await Promise.all([
            fetchPlansFromDB(),
            fetchUsersFromDB(),
            fetchSimuladoClassesFromDB()
        ]);
        setPlans(p);
        setUsers(u);
        setSimuladoClasses(s);
    };

    const handleDeleteSimClass = async (id: string) => {
        if(confirm("Excluir esta turma de simulados?")) {
            await deleteSimuladoClassFromDB(id);
            loadData();
        }
    }

    const handleDuplicateSimClass = async (sc: SimuladoClass) => {
        const newClass = { ...sc, id: uuid(), name: `${sc.name} (Cópia)` };
        await saveSimuladoClassToDB(newClass);
        loadData();
    }

    return (
        <div className="w-full h-full flex flex-col bg-[#050505] text-white">
            <div className="h-14 border-b border-[#333] bg-[#0F0F0F] flex items-center px-8 gap-8 shrink-0">
                <div className="flex gap-6 flex-1">
                    <button onClick={() => setActiveTab('plans')} className={`text-xs font-bold uppercase py-4 border-b-2 transition ${activeTab === 'plans' ? 'text-white border-insanus-red' : 'text-gray-500 border-transparent'}`}>Planos</button>
                    <button onClick={() => setActiveTab('users')} className={`text-xs font-bold uppercase py-4 border-b-2 transition ${activeTab === 'users' ? 'text-white border-insanus-red' : 'text-gray-500 border-transparent'}`}>Alunos</button>
                    <button onClick={() => setActiveTab('simulados')} className={`text-xs font-bold uppercase py-4 border-b-2 transition ${activeTab === 'simulados' ? 'text-white border-insanus-red' : 'text-gray-500 border-transparent'}`}>Simulados</button>
                    <button onClick={() => setActiveTab('maintenance')} className={`text-xs font-bold uppercase py-4 border-b-2 transition ${activeTab === 'maintenance' ? 'text-white border-insanus-red' : 'text-gray-500 border-transparent'}`}>Manutenção</button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                {activeTab === 'maintenance' && <MaintenanceView currentUser={user} />}
                
                {activeTab === 'simulados' && (
                    <div className="space-y-6">
                        <div className="flex justify-between items-center">
                            <h2 className="text-2xl font-black uppercase">Turmas de Simulados</h2>
                            <button onClick={() => setEditingSimClass({ id: uuid(), name: 'Nova Turma', simulados: [] })} className="bg-insanus-red hover:bg-red-600 text-white px-4 py-2 rounded font-bold text-xs uppercase shadow-neon">+ Nova Turma</button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {simuladoClasses.map(sc => (
                                <div key={sc.id} className="bg-[#121212] border border-[#333] p-6 rounded-xl">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="w-10 h-10 bg-blue-900/20 rounded-lg flex items-center justify-center border border-blue-500/30 text-blue-500">
                                            <Icon.List className="w-5 h-5"/>
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={() => setEditingSimClass(sc)} className="px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded text-[10px] font-bold uppercase text-white transition">Gerenciar</button>
                                            <button onClick={() => handleDuplicateSimClass(sc)} className="p-1 text-gray-500 hover:text-white transition" title="Duplicar"><Icon.Copy className="w-4 h-4"/></button>
                                            <button onClick={() => handleDeleteSimClass(sc.id)} className="p-1 text-gray-600 hover:text-red-500 transition"><Icon.Trash className="w-4 h-4"/></button>
                                        </div>
                                    </div>
                                    <h3 className="font-bold text-white text-lg mb-1">{sc.name}</h3>
                                    <p className="text-xs text-gray-500">{sc.simulados.length} simulados cadastrados</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Placeholders for Plans and Users tabs to complete the file structure */}
                {activeTab === 'plans' && (
                    <div className="text-center py-20 text-gray-500 italic">
                        Funcionalidade de Planos simplificada para este exemplo.
                        Use a aba Manutenção para restaurar dados completos.
                    </div>
                )}
                 {activeTab === 'users' && (
                    <div className="text-center py-20 text-gray-500 italic">
                        Funcionalidade de Usuários simplificada para este exemplo.
                    </div>
                )}
            </div>
        </div>
    );
};