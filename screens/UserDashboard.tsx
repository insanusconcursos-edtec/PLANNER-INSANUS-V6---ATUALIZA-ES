
import React, { useState, useEffect, useRef } from 'react';
import { User, StudyPlan, Routine, Goal, SubGoal, UserProgress, GoalType, PlanConfig, Discipline, Subject, UserLevel, SimuladoClass, Simulado, SimuladoAttempt, ScheduledItem, EditalTopic, Cycle, CycleItem, Flashcard, EditalSubTopic, ScheduledRevision, PersonalFlashcardSet, MindMapNode, PersonalMindMap, PersonalNote } from '../types';
import { Icon } from '../components/Icons';
import { WEEKDAYS, calculateGoalDuration, uuid } from '../constants';
import { fetchPlansFromDB, saveUserToDB, fetchSimuladoClassesFromDB, fetchSimuladoAttemptsFromDB, saveSimuladoAttemptToDB, fetchUsersFromDB } from '../services/db';
import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';
import { VisualMindMapModal } from '../components/MindMapEditor';
import { auth } from '../firebase';
import { updatePassword } from 'firebase/auth';

interface Props {
  user: User;
  onUpdateUser: (user: User) => void;
  onReturnToAdmin?: () => void;
}

// --- HELPER FUNCTIONS ---

const openWatermarkedPDF = async (url: string, user: User) => {
    try {
        document.body.style.cursor = 'wait';
        const existingPdfBytes = await fetch(url).then(res => res.arrayBuffer());
        const pdfDoc = await PDFDocument.load(existingPdfBytes);
        const helveticaFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const pages = pdfDoc.getPages();
        const watermarkText = `${user.name} - ${user.cpf}`;
        const watermarkSize = 10; 

        pages.forEach(page => {
            const { width, height } = page.getSize();
            const stepX = 200; 
            const stepY = 200;
            for (let y = 0; y < height; y += stepY) {
                const offsetX = (y / stepY) % 2 === 0 ? 0 : stepX / 2;
                for (let x = -stepX; x < width; x += stepX) {
                    page.drawText(watermarkText, {
                        x: x + offsetX, y: y + 20, size: watermarkSize, font: helveticaFont,
                        color: rgb(0.8, 0.2, 0.2), opacity: 0.15, rotate: degrees(45),
                    });
                }
            }
        });
        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, '_blank');
    } catch (e) {
        console.error("Erro ao gerar marca d'água", e);
        window.open(url, '_blank');
    } finally {
        document.body.style.cursor = 'default';
    }
};

const getTodayStr = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split('T')[0];
};

const formatDate = (dateStr: string) => {
    if(!dateStr) return '--/--';
    const parts = dateStr.split('-');
    return `${parts[2]}/${parts[1]}`; 
};

const formatSecondsToTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s}s`;
};

const formatStopwatch = (seconds: number) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
};

const getDayName = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00'); 
    const dayMap = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
    return dayMap[d.getDay()];
};

const getWeekDays = (baseDateStr: string) => {
    const [y, m, d] = baseDateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const day = date.getDay(); 
    const diff = date.getDate() - day; 
    const startOfWeek = new Date(date.setDate(diff));
    
    const days = [];
    for (let i = 0; i < 7; i++) {
        const current = new Date(startOfWeek);
        current.setDate(startOfWeek.getDate() + i);
        // ISO string fix for local time
        const iso = new Date(current.getTime() - (current.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
        days.push(iso);
    }
    return days;
};

const getDaysRemaining = (dateStr?: string) => {
    if (!dateStr) return 9999;
    const diff = new Date(dateStr).getTime() - new Date().getTime();
    return Math.ceil(diff / (1000 * 3600 * 24));
};

// --- SCHEDULER LOGIC ---

const expandCycleItems = (plan: StudyPlan, cycle: Cycle): CycleItem[] => {
  let expanded: CycleItem[] = [];
  for (const item of cycle.items) {
    if (item.folderId) {
      const disciplines = plan.disciplines.filter(d => d.folderId === item.folderId);
      disciplines.sort((a, b) => a.order - b.order);
      disciplines.forEach(d => {
        expanded.push({ ...item, folderId: undefined, disciplineId: d.id });
      });
    } else {
      expanded.push(item);
    }
  }
  return expanded;
};

const isSimuladoCompleted = (simId: string, attempts: SimuladoAttempt[]) => {
  return attempts.some(a => a.simuladoId === simId);
};

// Calculate specific duration for a sub-goal (atomic unit)
const calculateSubGoalDuration = (baseDuration: number, level: UserLevel, semiActiveStudy: boolean): number => {
    let duration = baseDuration || 0;
    
    let levelMultiplier = 1;
    if (level === 'intermediario') levelMultiplier = 0.75;
    else if (level === 'avancado') levelMultiplier = 0.50;
    
    duration = duration * levelMultiplier;

    if (semiActiveStudy) {
        duration = duration * 2;
    }

    return Math.ceil(duration > 0 ? duration : 10);
};

interface SchedulerEntry {
    goal: Goal;
    subjectId: string;
    subjectName: string;
    subGoalId?: string; // If AULA
    isAtomic: boolean; // True if this is a sub-part of a goal
    duration: number;
}

const generateSchedule = (
    plan: StudyPlan,
    routine: Routine,
    startDateStr: string,
    completedGoalIds: string[],
    level: UserLevel,
    isPaused: boolean,
    allSimulados: Simulado[],
    attempts: SimuladoAttempt[],
    advanceMode: boolean,
    semiActiveStudy: boolean = false,
    revisions: ScheduledRevision[] = [],
    dailySessionSeconds: number = 0
): Record<string, ScheduledItem[]> => {
    const schedule: Record<string, ScheduledItem[]> = {};
    
    const addItem = (date: string, item: ScheduledItem) => {
        if (!schedule[date]) schedule[date] = [];
        schedule[date].push(item);
    };

    // 1. Revisions (Fixed Dates)
    if (revisions) {
        revisions.forEach(rev => {
            let originalGoal: Goal | undefined;
            let disciplineName = 'Revisão';
            let subjectName = 'Geral';
            
            for (const d of plan.disciplines) {
                for (const s of d.subjects) {
                    const g = s.goals.find(g => g.id === rev.sourceGoalId);
                    if (g) {
                        originalGoal = g;
                        disciplineName = d.name;
                        subjectName = s.name;
                        break;
                    }
                }
                if(originalGoal) break;
            }

            if (originalGoal) {
                const baseDuration = calculateGoalDuration(originalGoal, level, semiActiveStudy);
                const revisionDuration = originalGoal.type === 'REVISAO' 
                    ? baseDuration 
                    : Math.max(10, Math.ceil(baseDuration * 0.2));

                addItem(rev.dueDate, {
                    uniqueId: rev.id,
                    date: rev.dueDate,
                    goalId: rev.sourceGoalId,
                    goalType: originalGoal.type,
                    title: `Revisão: ${originalGoal.title}`,
                    disciplineName,
                    subjectName,
                    duration: revisionDuration, 
                    isRevision: true,
                    revisionIndex: rev.interval,
                    completed: rev.completed,
                    originalGoal: originalGoal
                });
            }
        });
    }

    // 2. Study Schedule (Dynamic)
    if (!plan.cycles || plan.cycles.length === 0) return schedule;
    const activeCycle = plan.cycles[0]; 
    const cycleItems = expandCycleItems(plan, activeCycle);
    if (cycleItems.length === 0) return schedule;

    // FLATTEN GOALS INTO ATOMIC ENTRIES
    const tasksPerDiscipline: Record<string, SchedulerEntry[]> = {};
    
    plan.disciplines.forEach(d => {
        const tasks: SchedulerEntry[] = [];
        const sortedSubjects = [...d.subjects].sort((a,b) => a.order - b.order);
        
        sortedSubjects.forEach(s => {
            const sGoals = [...s.goals].sort((a,b) => a.order - b.order);
            sGoals.forEach(g => {
                if (g.type === 'AULA' && g.subGoals && g.subGoals.length > 0) {
                    g.subGoals.forEach(sg => {
                        tasks.push({
                            goal: g,
                            subjectId: s.id,
                            subjectName: s.name,
                            subGoalId: sg.id,
                            isAtomic: true,
                            duration: calculateSubGoalDuration(sg.duration, level, semiActiveStudy)
                        });
                    });
                } else {
                    tasks.push({
                        goal: g,
                        subjectId: s.id,
                        subjectName: s.name,
                        isAtomic: false,
                        duration: calculateGoalDuration(g, level, semiActiveStudy)
                    });
                }
            });
        });
        tasksPerDiscipline[d.id] = tasks;
    });

    let currentDate = new Date(startDateStr + 'T12:00:00'); 
    const maxDays = 365; 
    let daysProcessed = 0;
    let cycleIndex = 0; 
    const disciplineCursor: Record<string, number> = {};
    Object.keys(tasksPerDiscipline).forEach(k => disciplineCursor[k] = 0);

    while (daysProcessed < maxDays) {
        const dateStr = currentDate.toISOString().split('T')[0];
        
        if (isPaused && dateStr >= getTodayStr()) {
            break;
        }

        const dayName = getDayName(dateStr);
        let availableMin = routine.days[dayName] || 0;
        
        if (advanceMode && dateStr === getTodayStr()) {
             const usedRealMin = Math.floor(dailySessionSeconds / 60);
             availableMin = (routine.days[dayName] || 0) - usedRealMin;
        }

        const existingItems = schedule[dateStr] || [];
        const revisionTime = existingItems.reduce((acc, i) => {
            if (advanceMode && dateStr === getTodayStr() && i.completed) return acc;
            return acc + i.duration;
        }, 0);
        availableMin -= revisionTime;

        if (availableMin > 0) {
            let attemptsInDay = 0;
            const maxAttempts = cycleItems.length * 3; 
            
            while (availableMin > 0 && attemptsInDay < maxAttempts) {
                const item = cycleItems[cycleIndex % cycleItems.length];
                
                if (item.simuladoId) {
                        const simulado = allSimulados.find(s => s.id === item.simuladoId);
                        if (simulado) {
                            const isCompleted = isSimuladoCompleted(simulado.id, attempts);
                            const duration = simulado.totalQuestions * 3;
                            
                            const scheduledItem: ScheduledItem = {
                                uniqueId: uuid(),
                                date: dateStr,
                                goalId: simulado.id,
                                goalType: 'SIMULADO',
                                title: simulado.title,
                                disciplineName: 'Simulado',
                                subjectName: 'Geral',
                                duration: duration,
                                isRevision: false,
                                completed: isCompleted,
                                simuladoData: simulado
                            };
                            addItem(dateStr, scheduledItem);
                            
                            if (!(advanceMode && dateStr === getTodayStr() && isCompleted)) {
                                availableMin -= duration;
                            }
                            
                            cycleIndex++;
                        } else {
                            cycleIndex++;
                        }
                } else if (item.disciplineId) {
                    const disciplineId = item.disciplineId;
                    const tasks = tasksPerDiscipline[disciplineId] || [];
                    let cursor = disciplineCursor[disciplineId];
                    
                    let subjectsProcessed = 0;
                    const maxSubjects = (item.subjectsCount || 1);
                    let currentSubjectId = cursor < tasks.length ? tasks[cursor].subjectId : null;
                    
                    if (cursor >= tasks.length) {
                         cycleIndex++;
                         attemptsInDay++;
                         continue;
                    }

                    let workedOnThisDiscipline = false;

                    while (cursor < tasks.length) {
                        const currentTask = tasks[cursor];
                      let isDone = false;
                        if (currentTask.subGoalId) {
                            isDone = completedGoalIds.includes(`${currentTask.goal.id}:${currentTask.subGoalId}`);
                        } else {
                            isDone = completedGoalIds.includes(currentTask.goal.id);
                        }
                      if (availableMin <= 0 && !isDone) break;
                      
                      
                        
                        if (currentTask.subjectId !== currentSubjectId) {
                            subjectsProcessed++;
                            if (subjectsProcessed >= maxSubjects) {
                                break;
                            }
                            currentSubjectId = currentTask.subjectId;
                        }

                        

                        const cost = (advanceMode && dateStr === getTodayStr() && isDone) ? 0 : currentTask.duration;

                        // SOFT CAP LOGIC / FORCE FIT:
                        // Se houver tempo positivo disponível (availableMin > 0), agendamos a tarefa.
                        // Isso garante que o último bloco do dia seja agendado mesmo que estoure o tempo limite,
                        // evitando quebras de estudo (ex: Aula vai, mas questões ficam para amanhã).
                        if (availableMin > 0) {
                            const scheduledItem: ScheduledItem = {
                                uniqueId: uuid(),
                                date: dateStr,
                                goalId: currentTask.goal.id,
                                subGoalId: currentTask.subGoalId, 
                                goalType: currentTask.goal.type,
                                title: currentTask.subGoalId 
                                    ? (currentTask.goal.subGoals?.find(s => s.id === currentTask.subGoalId)?.title || currentTask.goal.title)
                                    : currentTask.goal.title,
                                disciplineName: plan.disciplines.find(d => d.id === disciplineId)?.name || 'Disciplina',
                                subjectName: currentTask.subjectName || 'Tópico', 
                                duration: currentTask.duration,
                                isRevision: false,
                                completed: isDone,
                                originalGoal: currentTask.goal
                            };
                            addItem(dateStr, scheduledItem);
                            availableMin -= cost; // Pode ficar negativo, o que é intencional para encerrar o dia após este bloco
                            cursor++;
                            workedOnThisDiscipline = true;
                        } else {
                            // Dia acabou
                            break;
                        }
                    }
                    
                    disciplineCursor[disciplineId] = cursor;
                    
                    if (workedOnThisDiscipline || cursor >= tasks.length) {
                        if (subjectsProcessed >= maxSubjects || cursor >= tasks.length) {
                             cycleIndex++;
                        }
                    } else {
                        if (availableMin > 0) {
                             cycleIndex++;
                        }
                    }
                } else {
                    cycleIndex++;
                }
                attemptsInDay++;
            }
        }

        currentDate.setDate(currentDate.getDate() + 1);
        daysProcessed++;
    }

    return schedule;
};

interface GroupedScheduledItem {
    goalId: string;
    goalType: GoalType;
    title: string;
    disciplineName: string;
    subjectName: string;
    totalDuration: number;
    items: ScheduledItem[];
    originalGoal?: Goal;
    simuladoData?: Simulado;
    completed: boolean;
    isRevisionItem?: boolean;
}

const groupScheduleItems = (items: ScheduledItem[]): GroupedScheduledItem[] => {
    const groups: Record<string, GroupedScheduledItem> = {};
    items.forEach(item => {
        const key = item.isRevision ? item.uniqueId : item.goalId;
        
        if (!groups[key]) {
            groups[key] = {
                goalId: item.goalId,
                goalType: item.goalType,
                title: item.originalGoal?.title || item.title,
                disciplineName: item.disciplineName,
                subjectName: item.subjectName,
                totalDuration: 0,
                items: [],
                originalGoal: item.originalGoal,
                simuladoData: item.simuladoData,
                completed: true,
                isRevisionItem: item.isRevision
            };
        }
        groups[key].items.push(item);
        groups[key].totalDuration += item.duration;
    });
    
    Object.values(groups).forEach(g => {
        g.completed = g.items.every(i => i.completed);
    });

    return Object.values(groups);
};

// --- MIGRATION MODAL COMPONENT ---

interface MigrationModalProps {
    user: User;
    plans: StudyPlan[];
    sourceItem: any;
    sourceType: 'flashcard' | 'mindmap' | 'note';
    onClose: () => void;
    onConfirm: (targetPlanId: string, targetGoalId: string) => void;
}

const MigrationModal: React.FC<MigrationModalProps> = ({ user, plans, sourceItem, sourceType, onClose, onConfirm }) => {
    const [selectedPlanId, setSelectedPlanId] = useState('');
    const [selectedTargetId, setSelectedTargetId] = useState('');

    // Filter plans user has access to, excluding current if needed (but user might want to copy within same plan to different topic, so we allow all allowed plans)
    const allowedPlans = plans.filter(p => user.allowedPlans.includes(p.id));

    // Get valid targets based on source type
    const getValidTargets = (planId: string) => {
        const plan = plans.find(p => p.id === planId);
        if (!plan || !plan.editalVerticalizado) return [];

        const targets: { id: string; label: string }[] = [];
        const requiredLinkType = sourceType === 'flashcard' ? 'revisao' : sourceType === 'mindmap' ? 'resumo' : 'questoes';

        plan.editalVerticalizado.forEach(disc => {
            disc.topics.forEach(topic => {
                // Check main topic link
                const mainLinkId = topic.links[requiredLinkType as keyof typeof topic.links];
                if (mainLinkId) {
                    targets.push({ id: mainLinkId, label: `${disc.name} > ${topic.name}` });
                }
                // Check subtopics
                if (topic.subTopics) {
                    topic.subTopics.forEach(sub => {
                        const subLinkId = sub.links[requiredLinkType as keyof typeof sub.links];
                        if (subLinkId) {
                            targets.push({ id: subLinkId, label: `${disc.name} > ${topic.name} > ${sub.name}` });
                        }
                    });
                }
            });
        });
        return targets;
    };

    const validTargets = selectedPlanId ? getValidTargets(selectedPlanId) : [];

    const handleConfirm = () => {
        if (selectedPlanId && selectedTargetId) {
            onConfirm(selectedPlanId, selectedTargetId);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-[#121212] border border-[#333] p-6 rounded-2xl w-full max-w-md shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-insanus-red"></div>
                <h3 className="text-xl font-bold text-white mb-4 uppercase flex items-center gap-2">
                    <Icon.Share2 className="w-5 h-5 text-insanus-red"/> Enviar para outro Plano
                </h3>
                <p className="text-gray-400 text-xs mb-6">
                    Selecione o plano e o tópico de destino para criar uma cópia de <strong>"{sourceItem.name || sourceItem.title}"</strong>.
                </p>

                <div className="space-y-4 mb-6">
                    <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">1. Selecione o Plano de Destino</label>
                        <select 
                            value={selectedPlanId} 
                            onChange={e => { setSelectedPlanId(e.target.value); setSelectedTargetId(''); }}
                            className="w-full bg-[#1A1A1A] border border-[#333] rounded-lg p-3 text-white text-xs outline-none focus:border-insanus-red"
                        >
                            <option value="">-- Selecione --</option>
                            {allowedPlans.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">2. Selecione o Tópico (Edital)</label>
                        <select 
                            value={selectedTargetId} 
                            onChange={e => setSelectedTargetId(e.target.value)}
                            disabled={!selectedPlanId}
                            className="w-full bg-[#1A1A1A] border border-[#333] rounded-lg p-3 text-white text-xs outline-none focus:border-insanus-red disabled:opacity-50"
                        >
                            <option value="">{selectedPlanId ? '-- Selecione o Local --' : '-- Aguardando Plano --'}</option>
                            {validTargets.map(t => (
                                <option key={t.id} value={t.id}>{t.label}</option>
                            ))}
                        </select>
                        <p className="text-[9px] text-gray-600 mt-1 italic">
                            * Exibindo apenas tópicos que possuem metas de {sourceType === 'flashcard' ? 'Revisão' : sourceType === 'mindmap' ? 'Resumo' : 'Questões'}.
                        </p>
                    </div>
                </div>

                <div className="flex gap-3">
                    <button onClick={onClose} className="flex-1 bg-transparent border border-gray-700 hover:border-white text-gray-300 py-3 rounded-xl font-bold text-xs uppercase transition">Cancelar</button>
                    <button 
                        onClick={handleConfirm} 
                        disabled={!selectedTargetId}
                        className="flex-1 bg-insanus-red hover:bg-red-600 text-white py-3 rounded-xl font-bold text-xs uppercase shadow-neon transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Copiar Arquivo
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- RICH TEXT EDITOR & NOTEBOOK MODAL ---

interface NotebookModalProps {
    goalId: string;
    goalTitle: string;
    notes: PersonalNote[];
    onSave: (note: PersonalNote) => void;
    onDelete: (noteId: string) => void;
    onClose: () => void;
}

const NotebookModal: React.FC<NotebookModalProps> = ({ goalId, goalTitle, notes, onSave, onDelete, onClose }) => {
    const [selectedNote, setSelectedNote] = useState<PersonalNote | null>(null);
    const [editorContent, setEditorContent] = useState('');
    const [editorTitle, setEditorTitle] = useState('');
    const editorRef = useRef<HTMLDivElement>(null);

    const [tableRows, setTableRows] = useState(2);
    const [tableCols, setTableCols] = useState(2);
    const [showTableConfig, setShowTableConfig] = useState(false);

    useEffect(() => {
        if (selectedNote) {
            setEditorTitle(selectedNote.title);
            setEditorContent(selectedNote.content);
            if(editorRef.current) editorRef.current.innerHTML = selectedNote.content;
        } else {
            setEditorTitle('Nova Anotação');
            setEditorContent('');
            if(editorRef.current) editorRef.current.innerHTML = '';
        }
    }, [selectedNote]);

    useEffect(() => {
        if (selectedNote && !notes.find(n => n.id === selectedNote.id)) {
            setSelectedNote(null);
        }
    }, [notes, selectedNote]);

    const execCmd = (command: string, value: string | undefined = undefined) => {
        document.execCommand(command, false, value);
        if (editorRef.current) {
            editorRef.current.focus();
        }
    };

    const handleSave = () => {
        if (!editorRef.current) return;
        const content = editorRef.current.innerHTML;
        const note: PersonalNote = {
            id: selectedNote ? selectedNote.id : uuid(),
            title: editorTitle || 'Sem Título',
            content: content,
            updatedAt: new Date().toISOString()
        };
        onSave(note);
        setSelectedNote(null);
    };

    const createNew = () => {
        setSelectedNote(null);
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-6 animate-fade-in">
            <div className="bg-[#121212] border border-[#333] w-full max-w-5xl h-[85vh] rounded-2xl flex overflow-hidden shadow-2xl relative">
                <div className="w-1/3 border-r border-[#333] flex flex-col bg-[#0F0F0F]">
                    <div className="p-4 border-b border-[#333]">
                        <h3 className="text-white font-black uppercase text-sm tracking-widest mb-1 truncate">{goalTitle}</h3>
                        <p className="text-[10px] text-gray-500 font-bold uppercase">Caderno de Questões</p>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
                        <button onClick={createNew} className="w-full py-3 border border-dashed border-[#333] rounded-lg text-gray-500 hover:text-white hover:border-white/20 text-xs font-bold uppercase transition flex items-center justify-center gap-2">
                            <Icon.Plus className="w-4 h-4"/> Nova Anotação
                        </button>
                        {notes.map(note => (
                            <div key={note.id} onClick={() => setSelectedNote(note)} className={`p-3 rounded-lg cursor-pointer transition border group ${selectedNote?.id === note.id ? 'bg-[#1E1E1E] border-insanus-red shadow-lg' : 'bg-transparent border-transparent hover:bg-white/5 hover:border-white/10'}`}>
                                <div className="flex justify-between items-start">
                                    <h4 className={`font-bold text-xs truncate ${selectedNote?.id === note.id ? 'text-white' : 'text-gray-400'}`}>{note.title}</h4>
                                    <button onClick={(e) => { 
                                        e.stopPropagation(); 
                                        onDelete(note.id); 
                                    }} className="text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"><Icon.Trash className="w-3 h-3"/></button>
                                </div>
                                <p className="text-[9px] text-gray-600 mt-1">{new Date(note.updatedAt).toLocaleDateString()}</p>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex-1 flex flex-col bg-[#121212]">
                    <div className="p-4 border-b border-[#333] flex items-center gap-4 bg-[#151515]">
                        <input 
                            value={editorTitle}
                            onChange={(e) => setEditorTitle(e.target.value)}
                            className="bg-transparent text-xl font-bold text-white placeholder-gray-600 outline-none flex-1"
                            placeholder="Título da Anotação..."
                        />
                        <div className="flex gap-2">
                            <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-bold uppercase text-gray-400 hover:text-white transition">Fechar</button>
                            <button onClick={handleSave} className="bg-insanus-red hover:bg-red-600 text-white px-6 py-2 rounded-lg text-xs font-bold uppercase shadow-neon transition transform active:scale-95">Salvar</button>
                        </div>
                    </div>
                    
                    <div className="p-2 border-b border-[#333] bg-[#1A1A1A] flex flex-wrap gap-1 items-center sticky top-0 z-10">
                        {[
                            { cmd: 'bold', label: 'B', icon: null, style: 'font-bold' },
                            { cmd: 'italic', label: 'I', icon: null, style: 'italic' },
                            { cmd: 'underline', label: 'U', icon: null, style: 'underline' },
                            { cmd: 'strikeThrough', label: 'S', icon: null, style: 'line-through' },
                        ].map(btn => (
                            <button key={btn.cmd} onMouseDown={(e) => { e.preventDefault(); execCmd(btn.cmd); }} className={`w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 text-gray-300 font-serif ${btn.style}`}>{btn.label}</button>
                        ))}
                        <div className="w-px h-6 bg-[#333] mx-1"></div>
                        {[
                            { cmd: 'justifyLeft', icon: 'align-left' },
                            { cmd: 'justifyCenter', icon: 'align-center' },
                            { cmd: 'justifyRight', icon: 'align-right' },
                            { cmd: 'justifyFull', icon: 'align-justify' },
                        ].map(btn => (
                            <button key={btn.cmd} onMouseDown={(e) => { e.preventDefault(); execCmd(btn.cmd); }} className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 text-gray-300">
                                <span className="text-[10px] uppercase font-mono">{btn.icon.split('-')[1].charAt(0)}</span>
                            </button>
                        ))}
                        <div className="w-px h-6 bg-[#333] mx-1"></div>
                        
                        <div className="relative group/color w-8 h-8">
                            <button className="w-full h-full flex items-center justify-center rounded hover:bg-white/10 text-gray-300 font-serif font-bold" title="Cor do Texto">
                                <span style={{ borderBottom: '2px solid currentColor' }}>A</span>
                            </button>
                            <input 
                                type="color" 
                                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                onChange={(e) => execCmd('foreColor', e.target.value)}
                            />
                        </div>

                        <div className="relative group/highlight w-8 h-8">
                            <button className="w-full h-full flex items-center justify-center rounded hover:bg-white/10 text-gray-300" title="Marca Texto">
                                <Icon.Edit className="w-4 h-4 text-yellow-500 fill-current"/>
                            </button>
                            <input 
                                type="color" 
                                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                onChange={(e) => execCmd('hiliteColor', e.target.value)}
                            />
                        </div>

                        <div className="w-px h-6 bg-[#333] mx-1"></div>
                        <select onChange={(e) => { execCmd('fontSize', e.target.value); e.target.value = ''; }} className="bg-black text-gray-300 text-xs border border-[#333] rounded p-1 outline-none h-8 w-20 cursor-pointer">
                            <option value="">Tamanho</option>
                            <option value="1">Pequeno</option>
                            <option value="3">Normal</option>
                            <option value="5">Grande</option>
                            <option value="7">Enorme</option>
                        </select>
                        <div className="w-px h-6 bg-[#333] mx-1"></div>
                        <button onMouseDown={(e) => { e.preventDefault(); execCmd('insertHorizontalRule'); }} className="px-2 h-8 flex items-center justify-center rounded hover:bg-white/10 text-gray-300 text-[10px] font-bold uppercase">Divisória</button>
                        
                        {showTableConfig ? (
                            <div className="flex items-center gap-1 bg-[#222] rounded p-1 border border-[#444] animate-fade-in">
                                <input type="number" min="1" max="10" value={tableRows} onChange={e=>setTableRows(Number(e.target.value))} className="w-8 bg-black border border-[#555] text-xs text-white text-center rounded outline-none" placeholder="L"/>
                                <span className="text-[8px] text-gray-500">x</span>
                                <input type="number" min="1" max="10" value={tableCols} onChange={e=>setTableCols(Number(e.target.value))} className="w-8 bg-black border border-[#555] text-xs text-white text-center rounded outline-none" placeholder="C"/>
                                <button onMouseDown={(e) => { 
                                    e.preventDefault(); 
                                    let html = '<table style="width:100%; border-collapse: collapse; margin: 10px 0; border: 1px solid #333;"><tbody>';
                                    for(let r=0; r<tableRows; r++){
                                        html += '<tr>';
                                        for(let c=0; c<tableCols; c++){
                                            html += '<td style="border: 1px solid #444; padding: 5px;">&nbsp;</td>';
                                        }
                                        html += '</tr>';
                                    }
                                    html += '</tbody></table><br/>';
                                    execCmd('insertHTML', html);
                                    setShowTableConfig(false);
                                }} className="px-2 py-0.5 bg-insanus-red text-white text-[9px] font-bold rounded hover:bg-red-600 transition">OK</button>
                                <button onClick={()=>setShowTableConfig(false)} className="px-1 text-gray-500 hover:text-white text-[9px] transition">X</button>
                            </div>
                        ) : (
                            <button onMouseDown={(e) => { e.preventDefault(); setShowTableConfig(true); }} className="px-2 h-8 flex items-center justify-center rounded hover:bg-white/10 text-gray-300 text-[10px] font-bold uppercase">+ Tabela</button>
                        )}
                    </div>

                    <div 
                        ref={editorRef}
                        contentEditable
                        className="flex-1 p-8 outline-none overflow-y-auto text-gray-200 text-base leading-relaxed max-w-4xl mx-auto w-full notebook-content"
                        style={{ minHeight: '300px' }}
                        onInput={(e) => setEditorContent(e.currentTarget.innerHTML)}
                    ></div>
                    
                    <style>{`
                        .notebook-content table { width: 100%; border-collapse: collapse; margin-bottom: 1em; }
                        .notebook-content td, .notebook-content th { border: 1px solid #444; padding: 8px; }
                        .notebook-content hr { border-color: #333; margin: 20px 0; }
                    `}</style>
                </div>
            </div>
        </div>
    );
};

// --- MIND MAP VIEWER COMPONENTS ---

interface MindMapNodeRendererProps {
    node: MindMapNode;
    depth?: number;
    isRoot?: boolean;
}

const MindMapNodeRenderer: React.FC<MindMapNodeRendererProps> = ({ node, depth = 0, isRoot = false }) => {
    const [expanded, setExpanded] = useState(isRoot);
    const hasChildren = node.children && node.children.length > 0;

    const levelColors = [
        'border-purple-500 bg-purple-900/20 text-purple-100 shadow-[0_0_15px_rgba(168,85,247,0.4)]', 
        'border-pink-500 bg-pink-900/10 text-pink-200',   
        'border-blue-500 bg-blue-900/10 text-blue-200',   
        'border-green-500 bg-green-900/10 text-green-200', 
        'border-yellow-500 bg-yellow-900/10 text-yellow-200' 
    ];
    const colorClass = isRoot ? levelColors[0] : levelColors[Math.min(depth, levelColors.length - 1)];

    return (
        <div className="flex items-center">
            <div className="flex flex-col items-center relative z-10 group">
                <div 
                    onClick={() => setExpanded(!expanded)}
                    className={`
                        relative px-6 py-3 rounded-2xl border-2 transition-all cursor-pointer transform hover:scale-105 hover:brightness-110 duration-300
                        ${colorClass}
                        ${!expanded && hasChildren ? 'opacity-80 ring-2 ring-white/20' : ''}
                        min-w-[120px] max-w-[250px] text-center backdrop-blur-sm flex items-center justify-center
                    `}
                >
                    {hasChildren && (
                        <div className={`
                            absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full 
                            bg-[#121212] border border-white/30 flex items-center justify-center 
                            text-[10px] shadow-lg transition-transform z-20 hover:bg-white/20
                        `}>
                            {expanded ? <Icon.ChevronRight className="w-3 h-3 text-white"/> : <span className="font-bold text-white">+</span>}
                        </div>
                    )}
                    <span 
                        className={`font-bold leading-tight ${isRoot ? 'text-sm uppercase tracking-wider' : 'text-xs'}`}
                        dangerouslySetInnerHTML={{ __html: node.label }} 
                    />
                </div>
            </div>
            {expanded && hasChildren && (
                <div className="flex items-center animate-fade-in">
                    <div className="w-8 h-0.5 bg-gray-600/50"></div>
                    <div className="flex flex-col relative">
                        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gray-600/50 transform -translate-x-0.5" 
                             style={{ 
                                 top: node.children!.length > 1 ? '50%' : '50%', 
                                 height: '100%' 
                             }}
                        ></div>
                        {node.children!.map((child, index) => (
                            <div key={child.id} className="flex items-center relative py-2">
                                <div className="h-full absolute left-0 w-0.5 bg-gray-600/50 -translate-x-0.5" style={{
                                    top: index === 0 ? '50%' : '0',
                                    height: index === 0 || index === node.children!.length - 1 ? '50%' : '100%',
                                    display: node.children!.length === 1 ? 'none' : 'block'
                                }}></div>
                                <div className="w-6 h-0.5 bg-gray-600/50"></div>
                                <MindMapNodeRenderer node={child} depth={depth + 1} />
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

interface MindMapModalProps {
    rootNode: MindMapNode;
    onClose: () => void;
}

const MindMapModal: React.FC<MindMapModalProps> = ({ rootNode, onClose }) => {
    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [startPos, setStartPos] = useState({ x: 0, y: 0 });
    const containerRef = useRef<HTMLDivElement>(null);

    const handleWheel = (e: React.WheelEvent) => {
        if (e.ctrlKey) {
            e.preventDefault();
            const delta = e.deltaY * -0.001;
            setScale(prev => Math.min(Math.max(.2, prev + delta), 3));
        }
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        setStartPos({ x: e.clientX - position.x, y: e.clientY - position.y });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging) return;
        setPosition({ x: e.clientX - startPos.x, y: e.clientY - startPos.y });
    };

    const handleMouseUp = () => setIsDragging(false);

    return (
        <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex flex-col animate-fade-in overflow-hidden">
            <div className="absolute top-6 left-6 z-40 pointer-events-none">
                <div className="text-[10px] text-gray-500 font-mono bg-black/50 px-3 py-1 rounded border border-white/5 backdrop-blur-sm">
                    Drag to Pan • Ctrl + Scroll to Zoom
                </div>
            </div>
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 bg-[#1A1A1A]/90 backdrop-blur border border-white/10 px-6 py-3 rounded-full shadow-2xl">
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-purple-500 animate-pulse"></div>
                    <span className="text-xs font-bold text-white uppercase tracking-widest">Mind Map Viewer</span>
                </div>
                <div className="h-4 w-px bg-white/20"></div>
                <div className="flex gap-2">
                    <button onClick={() => setScale(s => Math.max(0.2, s - 0.2))} className="p-1.5 hover:bg-white/10 rounded-full text-white transition"><Icon.ArrowDown className="w-4 h-4"/></button>
                    <span className="text-xs font-mono text-gray-400 w-12 text-center my-auto">{Math.round(scale * 100)}%</span>
                    <button onClick={() => setScale(s => Math.min(3, s + 0.2))} className="p-1.5 hover:bg-white/10 rounded-full text-white transition"><Icon.ArrowUp className="w-4 h-4"/></button>
                </div>
                <div className="h-4 w-px bg-white/20"></div>
                <button onClick={() => { setScale(1); setPosition({x:0, y:0}); }} className="text-[10px] font-bold text-gray-400 hover:text-white uppercase transition">Resetar</button>
                <div className="h-4 w-px bg-white/20"></div>
                <button onClick={onClose} className="p-1.5 bg-red-600/20 hover:bg-red-600 border border-red-500/50 rounded-full text-white transition group" title="Fechar">
                    <Icon.LogOut className="w-4 h-4"/>
                </button>
            </div>
            <div 
                ref={containerRef}
                className="w-full h-full cursor-move bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-[#1a1a1a] via-[#050505] to-[#000000]"
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
                    <MindMapNodeRenderer node={rootNode} isRoot={true} />
                </div>
            </div>
        </div>
    );
};

// --- FLASHCARD COMPONENTS ---

interface FlashcardViewerProps {
    flashcards: Flashcard[];
    onClose: () => void;
}

const FlashcardViewer: React.FC<FlashcardViewerProps> = ({ flashcards, onClose }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFlipped, setIsFlipped] = useState(false);

    if (!flashcards || flashcards.length === 0) return null;
    const currentCard = flashcards[currentIndex];

    const nextCard = () => { setIsFlipped(false); setTimeout(() => { if (currentIndex < flashcards.length - 1) setCurrentIndex(prev => prev + 1); else setCurrentIndex(0); }, 300); };
    const prevCard = () => { setIsFlipped(false); setTimeout(() => { if (currentIndex > 0) setCurrentIndex(prev => prev - 1); else setCurrentIndex(flashcards.length - 1); }, 300); };

    return (
        <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex items-center justify-center p-6 animate-fade-in">
            <div className="w-full max-w-2xl flex flex-col items-center">
                <div className="w-full flex justify-between items-center mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center shadow-neon border border-blue-400/50"><Icon.RefreshCw className="w-6 h-6 text-white"/></div>
                        <div><h3 className="text-xl font-black text-white uppercase tracking-wider">Revisão Ativa</h3><p className="text-xs text-blue-400 font-bold">Card {currentIndex + 1} de {flashcards.length}</p></div>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-white transition p-2 rounded-full hover:bg-white/10"><Icon.LogOut className="w-6 h-6"/></button>
                </div>
                <div className="relative w-full aspect-[16/9] cursor-pointer group" onClick={() => setIsFlipped(!isFlipped)} style={{ perspective: '1000px' }}>
                    <div className="w-full h-full relative" style={{ transformStyle: 'preserve-3d', transition: 'transform 0.6s', transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}>
                        <div className="absolute inset-0 bg-[#1E1E1E] border-2 border-blue-900/50 rounded-2xl p-8 flex flex-col justify-center items-center text-center shadow-2xl group-hover:border-blue-500/50 transition-colors" style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
                            <span className="text-xs font-bold text-blue-500 uppercase tracking-widest mb-4 bg-blue-900/20 px-3 py-1 rounded-full">Pergunta</span>
                            <p className="text-2xl font-bold text-white leading-relaxed">{currentCard.question}</p>
                            <div className="absolute bottom-8 bg-blue-600/20 border border-blue-500/50 text-blue-300 px-4 py-2 rounded-lg text-xs font-bold uppercase animate-pulse flex items-center gap-2"><Icon.Eye className="w-4 h-4"/> Ver Resposta</div>
                        </div>
                        <div className="absolute inset-0 bg-[#121212] border-2 border-green-500/50 rounded-2xl p-8 flex flex-col justify-center items-center text-center shadow-[0_0_30px_rgba(34,197,94,0.1)]" style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                            <span className="text-xs font-bold text-green-500 uppercase tracking-widest mb-4 bg-green-900/20 px-3 py-1 rounded-full">Resposta</span>
                            <p className="text-lg text-gray-200 leading-relaxed overflow-y-auto max-h-full custom-scrollbar w-full">{currentCard.answer}</p>
                        </div>
                    </div>
                </div>
                <div className="flex gap-4 mt-8 w-full">
                    <button onClick={(e) => { e.stopPropagation(); prevCard(); }} className="flex-1 bg-transparent border border-gray-700 hover:border-white/50 text-gray-400 hover:text-white py-4 rounded-xl font-bold text-xs uppercase transition flex items-center justify-center gap-2"><Icon.ArrowUp className="w-4 h-4 -rotate-90"/> Anterior</button>
                    <button onClick={(e) => { e.stopPropagation(); nextCard(); }} className="flex-[2] bg-blue-600 hover:bg-blue-500 text-white py-4 rounded-xl font-bold text-xs uppercase shadow-neon transition transform hover:scale-[1.02] flex items-center justify-center gap-2">{currentIndex === flashcards.length - 1 ? 'Recomeçar' : 'Próximo Card'} <Icon.ArrowDown className="-rotate-90 w-4 h-4"/></button>
                </div>
            </div>
        </div>
    );
};

// --- SIMULADO COMPONENTS ---

interface SimuladoRunnerProps {
    user: User;
    classId: string;
    simulado: Simulado;
    attempt?: SimuladoAttempt;
    allAttempts: SimuladoAttempt[];
    allUsersMap: Record<string, User>;
    onFinish: (result: SimuladoAttempt) => void;
    onBack: () => void;
}

const SimuladoRunner: React.FC<SimuladoRunnerProps> = ({ user, classId, simulado, attempt, allAttempts, allUsersMap, onFinish, onBack }) => {
    const [answers, setAnswers] = useState<Record<number, string | null>>(attempt?.answers || {});
    const [showResult, setShowResult] = useState(!!attempt);
    const [confirmFinish, setConfirmFinish] = useState(false);
    const [loadingPdf, setLoadingPdf] = useState(false);

    const handleAnswer = (q: number, val: string) => { if (showResult) return; setAnswers(prev => ({ ...prev, [q]: val })); };
    const handleOpenPdfSecure = async (url: string) => { setLoadingPdf(true); await openWatermarkedPDF(url, user); setLoadingPdf(false); }

    const finishSimulado = () => {
        let score = 0;
        for (let i = 1; i <= simulado.totalQuestions; i++) {
            const userAns = answers[i];
            const correctAns = simulado.correctAnswers[i];
            const val = simulado.questionValues[i] || 1;
            if (userAns && userAns === correctAns) score += val;
            else if (userAns && simulado.hasPenalty) score -= val;
        }
        if (score < 0) score = 0;
        const totalPoints = Object.values(simulado.questionValues).reduce((a: number, b: number) => a + b, 0) || simulado.totalQuestions;
        const percent = totalPoints > 0 ? (score / totalPoints) * 100 : 0;
        const isApproved = simulado.minTotalPercent ? percent >= simulado.minTotalPercent : percent >= 50;

        const result: SimuladoAttempt = {
            id: attempt?.id || uuid(),
            userId: user.id,
            simuladoId: simulado.id,
            classId: classId,
            date: new Date().toISOString(),
            answers,
            diagnosisReasons: {}, 
            score,
            isApproved
        };
        onFinish(result);
        setShowResult(true);
        setConfirmFinish(false);
    };

    const ranking = React.useMemo(() => {
        if (!showResult) return [];
        const relevantAttempts = allAttempts.filter(a => a.simuladoId === simulado.id);
        let finalAttempts = [...relevantAttempts];
        if (attempt && !finalAttempts.some(a => a.id === attempt.id)) finalAttempts.push(attempt);
        const best: Record<string, SimuladoAttempt> = {};
        finalAttempts.forEach(a => { const existing = best[a.userId]; if (!existing || a.score > existing.score) best[a.userId] = a; });
        return Object.values(best).sort((a, b) => b.score - a.score).map((a, index) => {
                const u = allUsersMap[a.userId];
                let displayName = u?.nickname || (u ? u.name.split(' ')[0] : 'Usuário');
                return { rank: index + 1, userId: a.userId, name: displayName, score: a.score, isCurrentUser: a.userId === user.id };
            });
    }, [showResult, allAttempts, simulado.id, attempt, user.id, allUsersMap]);

    return (
        <div className="w-full flex flex-col animate-fade-in pb-10">
             <div className="flex items-center justify-between mb-6 pb-4 border-b border-[#333]"><div className="flex items-center gap-4"><button onClick={onBack} className="text-gray-500 hover:text-white flex items-center gap-2 transition"><Icon.ArrowUp className="-rotate-90 w-5 h-5" /> <span className="text-xs font-bold uppercase">Sair</span></button><div className="h-6 w-px bg-[#333]"></div><h2 className="font-bold uppercase text-xl text-white">{simulado.title}</h2></div></div>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <div className="bg-[#121212] p-6 rounded-xl border border-[#333] flex flex-col items-center justify-center text-center gap-4 hover:border-white/20 transition group">
                    <div className="w-12 h-12 bg-insanus-red/10 rounded-full flex items-center justify-center group-hover:scale-110 transition"><Icon.Book className="w-6 h-6 text-insanus-red" /></div>
                    <div><h3 className="text-white font-bold uppercase text-sm">Material do Simulado</h3><p className="text-gray-500 text-xs mt-1">Baixe o PDF para resolver as questões.</p></div>
                    {simulado.pdfUrl ? (<button onClick={() => handleOpenPdfSecure(simulado.pdfUrl!)} className="bg-white/5 hover:bg-white/10 text-white border border-white/10 px-6 py-2 rounded-lg text-xs font-bold uppercase transition flex items-center gap-2 shadow-lg">{loadingPdf ? <Icon.RefreshCw className="w-4 h-4 animate-spin"/> : <Icon.Maximize className="w-4 h-4"/>} BAIXAR PROVA</button>) : (<span className="text-red-500 text-xs font-bold bg-red-900/10 px-3 py-1 rounded">PDF Indisponível</span>)}
                </div>
                <div className={`bg-[#121212] p-6 rounded-xl border border-[#333] flex flex-col items-center justify-center text-center gap-4 transition group ${!showResult ? 'opacity-50 grayscale' : 'hover:border-white/20'}`}>
                    <div className="w-12 h-12 bg-green-500/10 rounded-full flex items-center justify-center group-hover:scale-110 transition"><Icon.Check className="w-6 h-6 text-green-500" /></div>
                    <div><h3 className="text-white font-bold uppercase text-sm">Gabarito Comentado</h3><p className="text-gray-500 text-xs mt-1">{showResult ? 'Visualize as respostas e comentários.' : 'Disponível após finalizar o simulado.'}</p></div>
                    {simulado.gabaritoPdfUrl && showResult ? (<button onClick={() => handleOpenPdfSecure(simulado.gabaritoPdfUrl!)} className="bg-green-600/20 hover:bg-green-600/30 text-green-500 border border-green-600/50 px-6 py-2 rounded-lg text-xs font-bold uppercase transition flex items-center gap-2 shadow-lg"><Icon.Maximize className="w-4 h-4"/> ABRIR GABARITO</button>) : (<button disabled className="bg-black/20 text-gray-600 border border-white/5 px-6 py-2 rounded-lg text-xs font-bold uppercase cursor-not-allowed flex items-center gap-2"><Icon.EyeOff className="w-4 h-4"/> {showResult ? 'GABARITO INDISPONÍVEL' : 'BLOQUEADO'}</button>)}
                </div>
             </div>
             {confirmFinish && (<div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4"><div className="bg-[#121212] border border-[#333] p-8 rounded-xl max-sm shadow-neon"><h3 className="text-xl font-bold text-white mb-2">Finalizar Simulado?</h3><p className="text-gray-400 text-sm mb-6">Confira se marcou todas as respostas no gabarito digital.</p><div className="flex gap-4"><button onClick={() => setConfirmFinish(false)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg font-bold text-xs">VOLTAR</button><button onClick={finishSimulado} className="flex-1 bg-green-600 hover:bg-green-500 text-white py-3 rounded-lg font-bold text-xs shadow-lg">CONFIRMAR</button></div></div></div>)}
             <div className="flex-1 flex flex-col bg-[#050505]">
                {showResult && attempt && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                         <div className={`p-6 rounded-xl border flex flex-col justify-between ${attempt.isApproved ? 'bg-green-900/10 border-green-600/50' : 'bg-red-900/10 border-red-600/50'}`}><div><h3 className={`text-2xl font-black ${attempt.isApproved ? 'text-green-500' : 'text-red-500'}`}>{attempt.isApproved ? 'APROVADO' : 'REPROVADO'}</h3><p className="text-sm text-gray-300 mt-2">Nota Final: <span className="font-bold text-white text-xl ml-1">{attempt.score} pontos</span></p></div></div>
                         <div className="bg-[#121212] border border-[#333] rounded-xl overflow-hidden flex flex-col"><div className="bg-[#1E1E1E] p-3 border-b border-[#333] flex justify-between items-center"><h4 className="text-sm font-bold text-white uppercase flex items-gap-2"><Icon.List className="w-4 h-4 text-yellow-500"/> Ranking</h4></div><div className="flex-1 overflow-y-auto custom-scrollbar max-h-[200px]"><table className="w-full text-left border-collapse"><thead className="bg-black text-[10px] text-gray-500 font-bold uppercase sticky top-0"><tr><th className="p-2 pl-4">Pos</th><th className="p-2">Aluno</th><th className="p-2 text-right pr-4">Nota</th></tr></thead><tbody>{ranking.map((r) => (<tr key={r.userId} className={`border-b border-[#222] text-xs ${r.isCurrentUser ? 'bg-insanus-red/10' : ''}`}><td className="p-2 pl-4 font-bold text-gray-400">{r.rank}º</td><td className={`p-2 font-bold ${r.isCurrentUser ? 'text-insanus-red' : 'text-white'}`}>{r.name} {r.isCurrentUser && '(Você)'}</td><td className="p-2 text-right pr-4 font-mono font-bold text-white">{r.score}</td></tr>))}</tbody></table></div></div>
                    </div>
                 )}
                 <div className="bg-[#121212] rounded-xl border border-[#333] p-6">
                    <h3 className="text-white font-bold uppercase mb-6 flex items-center gap-2"><Icon.List className="w-5 h-5 text-insanus-red"/> Gabarito Digital</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {Array.from({ length: simulado.totalQuestions }).map((_, i) => {
                            const qNum = i + 1; const userAns = answers[qNum]; const correctAns = showResult ? simulado.correctAnswers[qNum] : null; const isCorrect = showResult && userAns === correctAns;
                            return (
                                <div key={qNum} className="flex flex-col gap-2 p-3 rounded bg-[#1A1A1A] border border-[#333]"><div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">Q{qNum}</span>{showResult && (<span className={`text-[10px] font-bold ${isCorrect ? 'text-green-500' : 'text-red-500'}`}>{isCorrect ? 'ACERTOU' : `GAB: ${correctAns}`}</span>)}</div>
                                    <div className="flex gap-1 justify-center">
                                        {simulado.type === 'MULTIPLA_ESCOLHA' ? (['A','B','C','D','E'].slice(0, simulado.optionsCount).map(opt => (<button key={opt} onClick={() => handleAnswer(qNum, opt)} disabled={showResult} className={`w-8 h-8 rounded text-[10px] font-bold transition-all ${userAns === opt ? 'bg-white text-black shadow-neon' : 'bg-black border border-[#333] text-gray-500 hover:border-white/50'} ${showResult && correctAns === opt ? '!bg-green-600 !text-white !border-green-600' : ''}`}>{opt}</button>))) : (['C','E'].map(opt => (<button key={opt} onClick={() => handleAnswer(qNum, opt)} disabled={showResult} className={`flex-1 h-8 rounded text-[10px] font-bold transition-all ${userAns === opt ? 'bg-white text-black' : 'bg-black border border-[#333] text-gray-500 hover:border-white/50'} ${showResult && correctAns === opt ? '!bg-green-600 !text-white !border-green-600' : ''}`}>{opt}</button>)))}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                 </div>
                 {!showResult && (<div className="mt-8"><button onClick={() => setConfirmFinish(true)} className="w-full bg-insanus-red hover:bg-red-700 text-white py-4 rounded-xl font-black text-sm uppercase shadow-neon transition-all transform hover:scale-[1.01] flex items-center justify-center gap-2"><Icon.Check className="w-5 h-5"/> FINALIZAR E ENVIAR RESPOSTAS</button></div>)}
             </div>
        </div>
    );
};

// --- WIZARD COMPONENT ---

const SetupWizard = ({ user, allPlans, currentPlan, onSave, onPlanAction, onUpdateUser, onSelectPlan }: { user: User, allPlans: StudyPlan[], currentPlan: StudyPlan | null, onSave: (r: Routine, l: UserLevel, semiActive: boolean) => void, onPlanAction: (action: 'pause' | 'reschedule' | 'restart') => void, onUpdateUser: (u: User) => void, onSelectPlan: (id: string) => void }) => {
    const [days, setDays] = useState(user.routine?.days || {});
    const [level, setLevel] = useState<UserLevel>(user.level || 'iniciante');
    const [semiActive, setSemiActive] = useState(user.semiActiveStudy || false);
    const [nickname, setNickname] = useState(user.nickname || ''); 
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [changingPass, setChangingPass] = useState(false);
    const [showRestartConfirm, setShowRestartConfirm] = useState(false);

    // NEW STATES FOR FILTERS
    const [availCat, setAvailCat] = useState('');
    const [availSub, setAvailSub] = useState('');
    const [availOrg, setAvailOrg] = useState('');

    const [lockedCat, setLockedCat] = useState('');
    const [lockedSub, setLockedSub] = useState('');
    const [lockedOrg, setLockedOrg] = useState('');

    const handleDayChange = (key: string, val: string) => { setDays(prev => ({ ...prev, [key]: parseInt(val) || 0 })); };
    const handleSaveProfile = async () => { if (nickname.length > 20) return alert("Apelido muito longo"); const updatedUser = { ...user, nickname: nickname.trim() }; onUpdateUser(updatedUser); await saveUserToDB(updatedUser); alert("Apelido atualizado!"); };
    
    const handleChangePassword = async () => {
        if (!newPassword.trim() || !confirmPassword.trim()) return alert("Preencha os campos");
        if (newPassword !== confirmPassword) return alert("Senhas não coincidem");
        if (newPassword.length < 6) return alert("Mínimo 6 caracteres."); // Firebase requires 6

        setChangingPass(true);
        try {
            // Atualização no Firebase Auth
            if (auth.currentUser) {
                await updatePassword(auth.currentUser, newPassword);
            }

            // Atualização no Banco de Dados (Legado/Admin View)
            const updatedUser = { ...user, tempPassword: newPassword };
            onUpdateUser(updatedUser);
            await saveUserToDB(updatedUser);

            alert("Senha alterada com sucesso!");
            setNewPassword('');
            setConfirmPassword('');
        } catch (e: any) {
            console.error("Erro ao alterar senha:", e);
            if (e.code === 'auth/requires-recent-login') {
                alert("Por medidas de segurança, faça logout e login novamente para alterar sua senha.");
            } else {
                alert("Erro ao alterar senha: " + (e.message || "Erro desconhecido"));
            }
        } finally {
            setChangingPass(false);
        }
    };

    const isPlanPaused = currentPlan ? user.planConfigs?.[currentPlan.id]?.isPaused : false;

    // SPLIT PLANS LOGIC
    const availablePlans = allPlans.filter(p => user.isAdmin || user.allowedPlans.includes(p.id));
    const lockedPlans = allPlans.filter(p => !user.isAdmin && !user.allowedPlans.includes(p.id));

    // GET UNIQUE CATEGORIES FOR DROPDOWNS
    const getCats = (list: StudyPlan[]) => Array.from(new Set(list.map(p => p.category))).filter(Boolean).sort();
    const getSubs = (list: StudyPlan[], cat: string) => Array.from(new Set(list.filter(p => p.category === cat).map(p => p.subCategory))).filter(Boolean).sort();

    // FILTER LOGIC
    const filteredAvailable = availablePlans.filter(p => 
        (!availCat || p.category === availCat) && 
        (!availSub || p.subCategory === availSub) &&
        (!availOrg || (p.organization && p.organization.toUpperCase().includes(availOrg.toUpperCase())))
    );
    const filteredLocked = lockedPlans.filter(p => 
        (!lockedCat || p.category === lockedCat) && 
        (!lockedSub || p.subCategory === lockedSub) &&
        (!lockedOrg || (p.organization && p.organization.toUpperCase().includes(lockedOrg.toUpperCase())))
    );

    const renderPlanCard = (plan: StudyPlan, hasAccess: boolean) => {
        const isActive = currentPlan?.id === plan.id; 
        const isPaused = user.planConfigs?.[plan.id]?.isPaused;
        const daysLeft = getDaysRemaining(user.planExpirations?.[plan.id]);
        const isExpired = daysLeft <= 0;

        return (
            <div key={plan.id} className={`relative rounded-xl border-2 overflow-hidden transition-all group flex flex-col h-full bg-[#0F0F0F] ${isActive ? 'border-insanus-red shadow-neon transform scale-[1.02]' : 'border-[#333]'} ${!hasAccess ? 'grayscale opacity-80 hover:grayscale-0 hover:opacity-100 transition-all duration-300' : 'hover:border-gray-500'}`}>
                <div className="aspect-square w-full bg-gray-800 relative overflow-hidden border-b border-[#333]">
                    {plan.coverImage ? ( <img src={plan.coverImage} alt={plan.name} className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" /> ) : ( <div className="flex items-center justify-center h-full w-full bg-gradient-to-br from-gray-800 to-black"><Icon.Image className="w-12 h-12 text-gray-600"/></div> )}
                    <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
                        {!hasAccess ? (
                             <span className="bg-black/90 text-gray-300 text-[8px] font-black px-2 py-1 rounded uppercase tracking-wider shadow-sm border border-white/20 flex items-center gap-1"><Icon.EyeOff className="w-3 h-3"/> BLOQUEADO</span>
                        ) : (
                            <>
                                {isActive && <span className="bg-insanus-red text-white text-[8px] font-black px-2 py-1 rounded uppercase tracking-wider shadow-sm">{isPaused ? 'PAUSADO' : 'ATIVO'}</span>}
                                {isExpired ? (
                                    <span className="bg-red-600 text-white text-[8px] font-black px-2 py-1 rounded uppercase tracking-wider shadow-sm border border-white/20">EXPIRADO</span>
                                ) : (
                                    <span className="bg-green-600 text-white text-[8px] font-black px-2 py-1 rounded uppercase tracking-wider shadow-sm border border-white/20">{daysLeft} DIAS</span>
                                )}
                            </>
                        )}
                    </div>
                </div>
                <div className="p-3 flex-1 flex flex-col">
                    <div className="mb-2">
                        <span className="text-[9px] text-gray-500 font-bold uppercase block mb-1 truncate">{(plan.category || 'GERAL').replace(/_/g, ' ')}</span>
                        <h4 className={`font-black text-sm leading-tight line-clamp-2 ${isActive ? 'text-white' : 'text-gray-300'}`}>{plan.name}</h4>
                    </div>
                    <div className="flex items-center gap-2 mt-auto pt-2 flex-col w-full">
                        {!hasAccess ? (
                            plan.purchaseLink ? (
                                <>
                                    <a href={plan.purchaseLink} target="_blank" rel="noreferrer" className="w-full py-2 bg-green-600 hover:bg-green-500 text-white border border-green-500 rounded text-[10px] font-bold uppercase transition flex items-center justify-center gap-2 shadow-lg w-full">
                                        <Icon.Check className="w-3 h-3"/> COMPRAR
                                    </a>
                                    <p className="text-[7px] text-gray-500 text-center leading-tight mt-1">O acesso será liberado em dias úteis no prazo de até 24 horas após a compra.</p>
                                </>
                            ) : (
                                <button disabled className="w-full py-2 bg-white/5 border border-white/10 rounded text-gray-600 text-[10px] font-bold uppercase cursor-not-allowed flex items-center justify-center gap-2"><Icon.EyeOff className="w-3 h-3"/> INDISPONÍVEL</button>
                            )
                        ) : (
                            <>
                                {isActive ? <div className="w-full text-center py-2 bg-insanus-red/10 border border-insanus-red rounded text-insanus-red text-[10px] font-bold uppercase">SELECIONADO</div> : isExpired ? <button disabled className="w-full py-2 bg-red-900/10 border border-red-900/30 rounded text-red-600 text-[10px] font-bold uppercase cursor-not-allowed flex items-center justify-center gap-2 opacity-60">BLOQUEADO</button> : <button onClick={() => onSelectPlan(plan.id)} className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/30 rounded text-gray-300 hover:text-white text-[10px] font-bold uppercase transition flex items-center justify-center gap-2">ESCOLHER</button>}
                            </>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="w-full space-y-8 animate-fade-in mt-4 relative">
            {showRestartConfirm && (<div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"><div className="bg-[#121212] border border-red-900/50 p-8 rounded-xl max-w-sm w-full text-center shadow-neon relative overflow-hidden"><div className="absolute top-0 left-0 w-full h-1 bg-red-600"></div><Icon.Trash className="w-12 h-12 text-red-600 mx-auto mb-4"/><h3 className="text-xl font-bold text-white mb-2 uppercase">Reiniciar Plano?</h3><p className="text-gray-400 text-sm mb-6 leading-relaxed">Isso apagará todo o seu progresso.<br/><br/><span className="text-red-500 font-bold bg-red-900/20 px-2 py-1 rounded">ESTA AÇÃO É IRREVERSÍVEL</span></p><div className="flex gap-4"><button onClick={() => setShowRestartConfirm(false)} className="flex-1 bg-transparent border border-gray-700 hover:border-gray-500 text-gray-300 py-3 rounded-lg font-bold text-xs uppercase transition">Cancelar</button><button onClick={() => { onPlanAction('restart'); setShowRestartConfirm(false); }} className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded-lg font-bold text-xs shadow-neon transition uppercase">Confirmar</button></div></div></div>)}
            
            {/* SECTION 1: AVAILABLE PLANS */}
            <div className="bg-[#121212] p-8 rounded-2xl border border-[#333]">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 border-b border-[#333] pb-4 gap-4">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2"><Icon.Book className="w-5 h-5 text-insanus-red"/> MEUS PLANOS (LIBERADOS)</h3>
                    <div className="flex gap-2">
                        <select value={availCat} onChange={e => { setAvailCat(e.target.value); setAvailSub(''); }} className="bg-black/40 border border-[#333] rounded px-3 py-2 text-xs text-white outline-none focus:border-insanus-red uppercase">
                            <option value="">Todas Categorias</option>
                            {getCats(availablePlans).map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select value={availSub} onChange={e => setAvailSub(e.target.value)} className="bg-black/40 border border-[#333] rounded px-3 py-2 text-xs text-white outline-none focus:border-insanus-red uppercase disabled:opacity-50" disabled={!availCat}>
                            <option value="">Todas Subcategorias</option>
                            {getSubs(availablePlans, availCat).map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <input 
                            type="text" 
                            placeholder="FILTRAR POR ÓRGÃO..." 
                            value={availOrg}
                            onChange={(e) => setAvailOrg(e.target.value)}
                            className="bg-black/40 border border-[#333] rounded px-3 py-2 text-xs text-white outline-none focus:border-insanus-red uppercase w-40"
                        />
                    </div>
                </div>
                {filteredAvailable.length === 0 ? (
                    <div className="text-gray-500 italic text-sm">Nenhum plano liberado encontrado com estes filtros.</div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                        {filteredAvailable.map(plan => renderPlanCard(plan, true))}
                    </div>
                )}
            </div>

            {/* SECTION 2: LOCKED PLANS (SHOP) */}
            <div className="bg-[#121212] p-8 rounded-2xl border border-[#333]">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 border-b border-[#333] pb-4 gap-4">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2"><Icon.List className="w-5 h-5 text-gray-500"/> LOJA DE PLANOS (BLOQUEADOS)</h3>
                    <div className="flex gap-2">
                        <select value={lockedCat} onChange={e => { setLockedCat(e.target.value); setLockedSub(''); }} className="bg-black/40 border border-[#333] rounded px-3 py-2 text-xs text-gray-300 outline-none focus:border-white uppercase">
                            <option value="">Todas Categorias</option>
                            {getCats(lockedPlans).map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select value={lockedSub} onChange={e => setLockedSub(e.target.value)} className="bg-black/40 border border-[#333] rounded px-3 py-2 text-xs text-gray-300 outline-none focus:border-white uppercase disabled:opacity-50" disabled={!lockedCat}>
                            <option value="">Todas Subcategorias</option>
                            {getSubs(lockedPlans, lockedCat).map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <input 
                            type="text" 
                            placeholder="FILTRAR POR ÓRGÃO..." 
                            value={lockedOrg}
                            onChange={(e) => setLockedOrg(e.target.value)}
                            className="bg-black/40 border border-[#333] rounded px-3 py-2 text-xs text-gray-300 outline-none focus:border-white uppercase w-40"
                        />
                    </div>
                </div>
                {filteredLocked.length === 0 ? (
                    <div className="text-gray-500 italic text-sm">Nenhum plano extra disponível.</div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                        {filteredLocked.map(plan => renderPlanCard(plan, false))}
                    </div>
                )}
            </div>

            {currentPlan && (<div className="bg-[#121212] p-6 rounded-2xl border border-[#333] relative overflow-hidden"><div className="absolute top-0 left-0 w-1 h-full bg-insanus-red"></div><h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><Icon.Edit className="w-5 h-5"/> GESTÃO DO PLANO ATUAL ({currentPlan.name})</h3><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"><div className="bg-[#1E1E1E] p-4 rounded-xl border border-[#333]"><h4 className="font-bold text-gray-300 text-sm mb-2">STATUS DO PLANO</h4><p className="text-xs text-gray-500 mb-4">Pausar o plano interrompe a geração de novas metas.</p><button onClick={() => onPlanAction('pause')} className={`w-full py-3 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition ${isPlanPaused ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-yellow-600 hover:bg-yellow-500 text-white'}`}>{isPlanPaused ? <Icon.Play className="w-4 h-4"/> : <Icon.Pause className="w-4 h-4"/>} {isPlanPaused ? 'RETOMAR PLANO' : 'PAUSAR PLANO'}</button></div><div className="bg-[#1E1E1E] p-4 rounded-xl border border-[#333]"><h4 className="font-bold text-gray-300 text-sm mb-2">ATRASOS E IMPREVISTOS</h4><p className="text-xs text-gray-500 mb-4">Replanejar define a data de início para HOJE.</p><button onClick={() => { if(confirm("Isso vai reorganizar todo o cronograma futuro. Continuar?")) onPlanAction('reschedule'); }} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition"><Icon.RefreshCw className="w-4 h-4"/> REPLANEJAR ATRASOS</button></div><div className="bg-red-900/10 p-4 rounded-xl border border-red-900/30 flex flex-col justify-between"><div><h4 className="font-bold text-red-500 text-sm mb-2 flex items-center gap-2"><Icon.Trash className="w-4 h-4"/> ZONA DE PERIGO</h4><p className="text-xs text-red-400 mb-4">Deseja recomeçar do zero?</p></div><button onClick={() => setShowRestartConfirm(true)} className="w-full py-3 bg-transparent border border-red-600 text-red-500 hover:bg-red-600 hover:text-white rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition">REINICIAR PLANO</button></div></div></div>)}
            <div className="bg-[#121212] p-8 rounded-2xl border border-[#333]">
                <div className="text-center mb-10"><Icon.Clock className="w-16 h-16 text-insanus-red mx-auto mb-4" /><h2 className="text-3xl font-black text-white uppercase tracking-tight">Configuração de Rotina</h2><p className="text-gray-400 mt-2 text-sm">Defina seu ritmo e disponibilidade.</p></div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                    <div>
                        <h3 className="text-lg font-bold text-white mb-4 border-b border-[#333] pb-2 flex items-center gap-2"><Icon.User className="w-4 h-4 text-insanus-red"/> SEU NÍVEL</h3>
                        <div className="space-y-3 mb-6">
                            {[{ id: 'iniciante', label: 'Iniciante', desc: 'Ritmo normal.' }, { id: 'intermediario', label: 'Intermediário', desc: 'Ritmo 1.5x.' }, { id: 'avancado', label: 'Avançado', desc: 'Ritmo 2.0x.' }].map((opt) => (<div key={opt.id} onClick={() => setLevel(opt.id as UserLevel)} className={`p-3 rounded-xl border cursor-pointer transition-all ${level === opt.id ? 'bg-insanus-red/20 border-insanus-red shadow-neon' : 'bg-[#1A1A1A] border-[#333] hover:border-[#555]'}`}><div className="flex justify-between items-center mb-1"><span className={`font-bold uppercase text-sm ${level === opt.id ? 'text-white' : 'text-gray-400'}`}>{opt.label}</span>{level === opt.id && <Icon.Check className="w-4 h-4 text-insanus-red"/>}</div><p className="text-[10px] text-gray-500">{opt.desc}</p></div>))}
                        </div>
                        
                        <div className="p-4 bg-[#1E1E1E] rounded-xl border border-[#333]">
                            <label className="flex items-center justify-between cursor-pointer group">
                                <div>
                                    <span className="font-bold text-white text-xs uppercase block mb-1">Estudo Semiativo</span>
                                    <span className="text-[10px] text-gray-500 block max-w-[200px]">Dobrar o tempo estimado de aulas para permitir pausas e anotações.</span>
                                </div>
                                <div className={`w-12 h-6 rounded-full p-1 transition-colors ${semiActive ? 'bg-insanus-red' : 'bg-[#333]'}`} onClick={() => setSemiActive(!semiActive)}>
                                    <div className={`w-4 h-4 bg-white rounded-full shadow-md transition-transform ${semiActive ? 'translate-x-6' : 'translate-x-0'}`}></div>
                                </div>
                            </label>
                        </div>
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white mb-4 border-b border-[#333] pb-2 flex items-center gap-2"><Icon.Calendar className="w-4 h-4 text-insanus-red"/> DISPONIBILIDADE (MIN)</h3>
                        <div className="space-y-2">{WEEKDAYS.map(d => (<div key={d.key} className="flex items-center justify-between bg-[#1A1A1A] p-2 px-3 rounded border border-[#333] hover:border-[#555] transition"><span className="text-xs font-bold text-gray-300 uppercase">{d.label}</span><div className="flex items-center gap-2"><input type="number" value={days[d.key] || ''} onChange={e => handleDayChange(d.key, e.target.value)} placeholder="0" className="w-16 bg-[#050505] border border-[#333] rounded p-1 text-right text-white font-mono text-sm focus:border-insanus-red outline-none"/><span className="text-[10px] text-gray-600">min</span></div></div>))}</div>
                    </div>
                </div>
                <button onClick={() => onSave({ days }, level, semiActive)} className="w-full mt-10 bg-insanus-red hover:bg-red-600 text-white font-bold py-4 rounded-xl shadow-neon transition transform hover:scale-[1.01] flex items-center justify-center gap-2"><Icon.RefreshCw className="w-5 h-5"/> SALVAR ROTINA E NÍVEL</button>
            </div>
            <div className="bg-[#121212] p-8 rounded-2xl border border-[#333]"><h3 className="text-lg font-bold text-white mb-6 border-b border-[#333] pb-2 flex items-center gap-2"><Icon.User className="w-4 h-4 text-insanus-red"/> PERFIL E RANKING</h3><div className="flex flex-col md:flex-row gap-4 items-end"><div className="flex-1 w-full"><label className="text-[10px] text-gray-500 font-bold uppercase block mb-1">Apelido</label><input type="text" value={nickname} onChange={e => setNickname(e.target.value)} className="w-full bg-black p-3 rounded-lg border border-white/10 text-white text-sm focus:border-insanus-red focus:outline-none" placeholder="Apelido para o ranking" maxLength={20}/></div><button onClick={handleSaveProfile} className="bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-lg border border-gray-700 transition flex items-center justify-center gap-2 shrink-0 h-[46px]">SALVAR PERFIL</button></div></div>
            <div className="bg-[#121212] p-8 rounded-2xl border border-[#333]"><h3 className="text-lg font-bold text-white mb-6 border-b border-[#333] pb-2 flex items-center gap-2"><Icon.Eye className="w-4 h-4 text-insanus-red"/> SEGURANÇA E ACESSO</h3><div className="grid grid-cols-1 md:grid-cols-2 gap-6"><div><label className="text-[10px] text-gray-500 font-bold uppercase block mb-1">Nova Senha</label><input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full bg-black p-3 rounded-lg border border-white/10 text-white text-sm focus:border-insanus-red focus:outline-none"/></div><div><label className="text-[10px] text-gray-500 font-bold uppercase block mb-1">Confirmar Nova Senha</label><input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full bg-black p-3 rounded-lg border border-white/10 text-white text-sm focus:border-insanus-red focus:outline-none"/></div></div><button onClick={handleChangePassword} disabled={changingPass} className="w-full mt-6 bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 rounded-xl border border-gray-700 transition disabled:opacity-50">{changingPass ? 'SALVANDO...' : 'ALTERAR SENHA'}</button></div>
        </div>
    );
};

export const UserDashboard: React.FC<Props> = ({ user, onUpdateUser, onReturnToAdmin }) => {
  const [view, setView] = useState<'setup' | 'daily' | 'calendar' | 'edital' | 'simulados'>('daily');
  const [calendarMode, setCalendarMode] = useState<'month' | 'week'>('week');
  const [plans, setPlans] = useState<StudyPlan[]>([]);
  const [currentPlan, setCurrentPlan] = useState<StudyPlan | null>(null);
  const [schedule, setSchedule] = useState<Record<string, ScheduledItem[]>>({});
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [editalExpanded, setEditalExpanded] = useState<string[]>([]);
  const [editalSubGoalsExpanded, setEditalSubGoalsExpanded] = useState<string[]>([]);
  const [advanceMode, setAdvanceMode] = useState(false);
  const [dismissAdvance, setDismissAdvance] = useState(false); // NEW STATE FOR DISMISS
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void; } | null>(null);
  const [activeFlashcards, setActiveFlashcards] = useState<Flashcard[] | null>(null);
  const [activeGoalId, setActiveGoalId] = useState<string | null>(null);
  const [activeSubGoalId, setActiveSubGoalId] = useState<string | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const timerRef = useRef<any>(null);
  const [simuladoClasses, setSimuladoClasses] = useState<SimuladoClass[]>([]);
  const [attempts, setAttempts] = useState<SimuladoAttempt[]>([]);
  const [activeSimulado, setActiveSimulado] = useState<Simulado | null>(null);
  const [allAttempts, setAllAttempts] = useState<SimuladoAttempt[]>([]);
  const [allUsersMap, setAllUsersMap] = useState<Record<string, User>>({});
  const [selectedDate, setSelectedDate] = useState(getTodayStr());
  const [editingPackId, setEditingPackId] = useState<string | null>(null);
  const [expandedPackIds, setExpandedPackIds] = useState<string[]>([]);
  const [activePersonalMindMap, setActivePersonalMindMap] = useState<PersonalMindMap | null>(null);
  const [editingMindMapNameId, setEditingMindMapNameId] = useState<string | null>(null);
  const [activeMindMapNode, setActiveMindMapNode] = useState<MindMapNode | null>(null);
  const [activeNotebookGoalId, setActiveNotebookGoalId] = useState<{ id: string, title: string } | null>(null);
  const [dailySessionSeconds, setDailySessionSeconds] = useState(0);
  
  // NEW: Active Simulado Class State for Navigation
  const [activeSimuladoClass, setActiveSimuladoClass] = useState<SimuladoClass | null>(null);
  
  // MIGRATION STATE
  const [migrationData, setMigrationData] = useState<{ type: 'flashcard' | 'mindmap' | 'note', item: any } | null>(null);

  // NEW: Filter States for Simulado Classes (Available vs Locked)
  const [availSimCat, setAvailSimCat] = useState('');
  const [availSimSub, setAvailSimSub] = useState('');
  const [availSimOrg, setAvailSimOrg] = useState('');

  const [lockedSimCat, setLockedSimCat] = useState('');
  const [lockedSimSub, setLockedSimSub] = useState('');
  const [lockedSimOrg, setLockedSimOrg] = useState('');

  useEffect(() => { loadData(); }, [user.id]); 
  useEffect(() => { if (isTimerRunning) { timerRef.current = setInterval(() => { setTimerSeconds(prev => prev + 1); }, 1000); } else { if (timerRef.current) clearInterval(timerRef.current); } return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, [isTimerRunning]);
  useEffect(() => { const hasRoutine = user.routine && user.routine.days && Object.values(user.routine.days).some((v: number) => v > 0); if (currentPlan && hasRoutine) { const config = user.planConfigs?.[currentPlan.id]; const allSimulados = simuladoClasses.flatMap(sc => sc.simulados); const generated = generateSchedule(currentPlan, user.routine, config?.startDate || getTodayStr(), user.progress.completedGoalIds, user.level || 'iniciante', config?.isPaused || false, allSimulados, attempts, advanceMode, user.semiActiveStudy, user.revisions, dailySessionSeconds); setSchedule(generated); } else { setSchedule({}); } }, [currentPlan, user.routine, user.progress.completedGoalIds, user.level, user.planConfigs, simuladoClasses, attempts, advanceMode, user.semiActiveStudy, user.revisions, dailySessionSeconds]);

  const loadData = async () => { 
      const allPlans = await fetchPlansFromDB(); 
      setPlans(allPlans);
      
      const allowedPlans = user.isAdmin ? allPlans : allPlans.filter(p => user.allowedPlans?.includes(p.id)); 
      
      let activePlan: StudyPlan | undefined; 
      if (user.currentPlanId) activePlan = allowedPlans.find(p => p.id === user.currentPlanId); 
      if (!activePlan && allowedPlans.length > 0) activePlan = allowedPlans[0]; 
      if (activePlan) setCurrentPlan(activePlan); 
      
      // LOAD ALL CLASSES TO SHOW LOCKED ONES TOO
      const allClasses = await fetchSimuladoClassesFromDB(); 
      setSimuladoClasses(allClasses);
      
      const fetchedAttempts = await fetchSimuladoAttemptsFromDB(); 
      setAllAttempts(fetchedAttempts); 
      setAttempts(fetchedAttempts.filter(a => a.userId === user.id)); 
      
      const fetchedUsers = await fetchUsersFromDB(); 
      const userMap: Record<string, User> = {}; 
      fetchedUsers.forEach(u => userMap[u.id] = u); 
      setAllUsersMap(userMap); 
      
      const hasRoutine = user.routine && user.routine.days && Object.values(user.routine.days).some((v: number) => v > 0); 
      if (!hasRoutine) setView('setup'); 
  };
  const executePlanSwitch = async (newPlanId: string) => { const targetPlan = plans.find(p => p.id === newPlanId); if (!targetPlan) return; const oldPlanId = currentPlan?.id; const newConfigs = { ...user.planConfigs }; if (oldPlanId) { newConfigs[oldPlanId] = { ...(newConfigs[oldPlanId] || { startDate: getTodayStr() }), isPaused: true }; } if (!newConfigs[newPlanId]) { newConfigs[newPlanId] = { startDate: getTodayStr(), isPaused: false }; } else { newConfigs[newPlanId] = { ...newConfigs[newPlanId], isPaused: false }; } const updatedUser = { ...user, currentPlanId: newPlanId, planConfigs: newConfigs }; setCurrentPlan(targetPlan); onUpdateUser(updatedUser); await saveUserToDB(updatedUser); setConfirmModal(null); setPendingPlanId(null); loadData(); };
  const initiatePlanSwitch = (newPlanId: string) => { if (newPlanId === currentPlan?.id) return; setPendingPlanId(newPlanId); setConfirmModal({ isOpen: true, title: "Trocar Plano de Estudos", message: "Ao selecionar este novo plano, seu plano atual será pausado e todo o seu progresso será salvo. Você poderá retornar a ele a qualquer momento. Confirmar troca?", onConfirm: () => executePlanSwitch(newPlanId) }); };
  const handleSetupSave = async (routine: Routine, level: UserLevel, semiActive: boolean) => { const updatedUser = { ...user, routine, level, semiActiveStudy: semiActive }; if (currentPlan) { const newConfigs = { ...updatedUser.planConfigs }; if (!newConfigs[currentPlan.id]) newConfigs[currentPlan.id] = { startDate: getTodayStr(), isPaused: false }; updatedUser.planConfigs = newConfigs; updatedUser.currentPlanId = currentPlan.id; } onUpdateUser(updatedUser); await saveUserToDB(updatedUser); setView('daily'); };
  const handlePlanAction = async (action: 'pause' | 'reschedule' | 'restart') => { if (!currentPlan) return; const config = user.planConfigs[currentPlan.id] || { startDate: getTodayStr(), isPaused: false }; if (action === 'restart') { const planGoalIds = new Set<string>(); currentPlan.disciplines.forEach(d => { d.subjects.forEach(s => { s.goals.forEach(g => planGoalIds.add(g.id)); }); }); const currentCompleted = (user.progress.completedGoalIds as string[]) || []; const newCompleted = currentCompleted.filter(id => !planGoalIds.has(id.split(':')[0])); const newRevisions = (user.revisions || []).filter(r => !planGoalIds.has(r.sourceGoalId)); const updatedUser = { ...user, progress: { ...user.progress, completedGoalIds: newCompleted }, revisions: newRevisions, planConfigs: { ...user.planConfigs, [currentPlan.id]: { startDate: getTodayStr(), isPaused: false } } }; onUpdateUser(updatedUser); await saveUserToDB(updatedUser); return; } let newConfig = { ...config }; if (action === 'pause') newConfig.isPaused = !newConfig.isPaused; else if (action === 'reschedule') { newConfig.startDate = getTodayStr(); newConfig.isPaused = false; } const updatedUser = { ...user, planConfigs: { ...user.planConfigs, [currentPlan.id]: newConfig } }; onUpdateUser(updatedUser); await saveUserToDB(updatedUser); };
  const startTimer = (gid: string, sid?: string) => { setIsTimerRunning(true); setActiveGoalId(gid); setActiveSubGoalId(sid || null); };
  const pauseTimer = () => setIsTimerRunning(false);
  const saveStudyTime = async (comp: boolean) => { const seconds = timerSeconds; 
    setDailySessionSeconds(prev => prev + seconds); 
    const newTotal = (user.progress.totalStudySeconds || 0) + seconds; const planTotal = (user.progress.planStudySeconds?.[currentPlan?.id || ''] || 0) + seconds; let newCompletedIds = [...(user.progress.completedGoalIds || [])]; if (activeGoalId && activeSubGoalId) { const subKey = `${activeGoalId}:${activeSubGoalId}`; if (!newCompletedIds.includes(subKey)) { newCompletedIds.push(subKey); } if (currentPlan) { let targetGoal: Goal | undefined; for (const d of currentPlan.disciplines) { for (const s of d.subjects) { const g = s.goals.find(x => x.id === activeGoalId); if (g) { targetGoal = g; break; } } if (targetGoal) break; } if (targetGoal && targetGoal.subGoals) { const allDone = targetGoal.subGoals.every(sg => newCompletedIds.includes(`${activeGoalId}:${sg.id}`)); if (allDone && !newCompletedIds.includes(activeGoalId)) { newCompletedIds.push(activeGoalId); } } } } else if (comp && activeGoalId) { if (!newCompletedIds.includes(activeGoalId)) newCompletedIds.push(activeGoalId); } const updatedUser = { ...user, progress: { ...user.progress, totalStudySeconds: newTotal, completedGoalIds: newCompletedIds, planStudySeconds: { ...user.progress.planStudySeconds, [currentPlan?.id||'']: planTotal } } }; setIsTimerRunning(false); setActiveGoalId(null); setActiveSubGoalId(null); setTimerSeconds(0); onUpdateUser(updatedUser); await saveUserToDB(updatedUser); };
  const toggleGoalComplete = (gid: string) => {
    // FIXED: REMOVED AUTO RESET OF ADVANCE MODE. USER CONTROLS IT.
    const realRevisionMatch = (user.revisions || []).find(r => r.id === gid); if (realRevisionMatch) { const updatedRevisions = (user.revisions || []).map(r => r.id === gid ? { ...r, completed: !r.completed } : r); const updatedUser = { ...user, revisions: updatedRevisions }; onUpdateUser(updatedUser); saveUserToDB(updatedUser); return; } if (gid.startsWith("virtual_")) { const parts = gid.split('_'); const sourceGoalId = parts[1]; const interval = parseInt(parts[2]); let targetDate = getTodayStr(); for (const dateKey in schedule) { if (schedule[dateKey].find(i => i.uniqueId === gid)) { targetDate = dateKey; break; } } const newRevision: ScheduledRevision = { id: uuid(), sourceGoalId, dueDate: targetDate, interval, completed: true }; const updatedUser = { ...user, revisions: [...(user.revisions || []), newRevision] }; onUpdateUser(updatedUser); saveUserToDB(updatedUser); return; } const currentCompletedIds = (user.progress.completedGoalIds as string[]) || []; const isCompleted = currentCompletedIds.includes(gid); let goalFound: Goal | undefined; if (currentPlan) { for (const d of currentPlan.disciplines) { for (const s of d.subjects) { const g = s.goals.find(x => x.id === gid); if (g) { goalFound = g; break; } } if (goalFound) break; } } if (!isCompleted) { setConfirmModal({ isOpen: true, title: "Concluir Meta?", message: "Deseja marcar esta meta como concluída?", onConfirm: () => { let newCompleted = [...currentCompletedIds]; if(!newCompleted.includes(gid)) newCompleted.push(gid); if(goalFound && goalFound.subGoals) { goalFound.subGoals.forEach(sg => { const sk = `${gid}:${sg.id}`; if(!newCompleted.includes(sk)) newCompleted.push(sk); }); } let newRevisions = [...(user.revisions || [])]; if (goalFound && goalFound.hasRevision) { const rawIntervals = goalFound.revisionIntervals?.trim() || ''; if (rawIntervals) { const intervals = rawIntervals.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n)); let accumulatedDate = new Date(); intervals.forEach(interval => { const targetDate = new Date(accumulatedDate); targetDate.setDate(targetDate.getDate() + interval); const y = targetDate.getFullYear(); const m = String(targetDate.getMonth() + 1).padStart(2, '0'); const d = String(targetDate.getDate()).padStart(2, '0'); newRevisions.push({ id: uuid(), sourceGoalId: gid, dueDate: `${y}-${m}-${d}`, interval, completed: false }); accumulatedDate = targetDate; }); } } const updatedUser = { ...user, progress: { ...user.progress, completedGoalIds: newCompleted }, revisions: newRevisions }; onUpdateUser(updatedUser); saveUserToDB(updatedUser); setConfirmModal(null); } }); } else { let newCompleted = currentCompletedIds.filter(id => id !== gid); if(goalFound && goalFound.subGoals) { const subKeys = goalFound.subGoals.map(sg => `${gid}:${sg.id}`); newCompleted = newCompleted.filter(id => !subKeys.includes(id)); } const newRevisions = (user.revisions || []).filter(r => r.sourceGoalId !== gid); const updatedUser = { ...user, progress: { ...user.progress, completedGoalIds: newCompleted }, revisions: newRevisions }; onUpdateUser(updatedUser); saveUserToDB(updatedUser); } };
  const handleManualSubGoalToggle = async (goalId: string, subId: string) => { const key = `${goalId}:${subId}`; const current = user.progress.completedGoalIds || []; let updated = []; if (current.includes(key)) { updated = current.filter(k => k !== key); } else { updated = [...current, key]; } const u = { ...user, progress: { ...user.progress, completedGoalIds: updated } }; onUpdateUser(u); await saveUserToDB(u); };
  
  const handlePersonalPackAction = async (goalId: string, action: 'add' | 'delete' | 'update', pack?: PersonalFlashcardSet) => { 
      const currentSets = user.personalFlashcardSets?.[goalId] || []; 
      
      if (action === 'delete' && pack) {
          setConfirmModal({
              isOpen: true,
              title: "Excluir Conjunto?",
              message: "Deseja excluir este conjunto de flashcards permanentemente?",
              onConfirm: async () => {
                  const updatedSets = currentSets.filter(s => s.id !== pack.id);
                  const updatedUser: User = { ...user, personalFlashcardSets: { ...(user.personalFlashcardSets || {}), [goalId]: updatedSets } }; 
                  onUpdateUser(updatedUser); 
                  await saveUserToDB(updatedUser);
                  setConfirmModal(null);
              }
          });
          return;
      }

      let updatedSets: PersonalFlashcardSet[] = [...currentSets]; 
      if (action === 'add') { 
          if (currentSets.length >= 3) return alert("Limite de 3 conjuntos por meta atingido."); 
          updatedSets.push({ id: uuid(), name: 'Meu Novo Conjunto', cards: [] }); 
      } else if (action === 'update' && pack) { 
          updatedSets = currentSets.map(s => s.id === pack.id ? pack : s); 
      } 
      
      const updatedUser: User = { ...user, personalFlashcardSets: { ...(user.personalFlashcardSets || {}), [goalId]: updatedSets } }; 
      onUpdateUser(updatedUser); 
      await saveUserToDB(updatedUser); 
  };
  
  const handlePersonalMindMapAction = async (goalId: string, action: 'add' | 'delete' | 'update', map?: PersonalMindMap) => { 
      const currentMaps = user.personalMindMaps?.[goalId] || []; 
      
      if (action === 'delete' && map) {
          setConfirmModal({
              isOpen: true,
              title: "Excluir Mapa Mental?",
              message: "Deseja realmente excluir este mapa mental permanentemente?",
              onConfirm: async () => {
                  const updatedMaps = currentMaps.filter(m => m.id !== map.id);
                  const updatedUser: User = { ...user, personalMindMaps: { ...(user.personalMindMaps || {}), [goalId]: updatedMaps } }; 
                  onUpdateUser(updatedUser); 
                  await saveUserToDB(updatedUser);
                  setConfirmModal(null);
              }
          });
          return;
      }

      let updatedMaps: PersonalMindMap[] = [...currentMaps]; 
      if (action === 'add') { 
          if (currentMaps.length >= 5) return alert("Limite de 5 mapas mentais por meta."); 
          updatedMaps.push({ id: uuid(), name: 'Novo Mapa Mental', root: { id: uuid(), label: 'Ideia Central', children: [] }, createdAt: new Date().toISOString() }); 
      } else if (action === 'update' && map) { 
          updatedMaps = currentMaps.map(m => m.id === map.id ? map : m); 
      } 
      
      const updatedUser: User = { ...user, personalMindMaps: { ...(user.personalMindMaps || {}), [goalId]: updatedMaps } }; 
      onUpdateUser(updatedUser); 
      await saveUserToDB(updatedUser); 
  };

  const executeMigration = async (targetPlanId: string, targetGoalId: string) => {
      if (!migrationData) return;
      const { type, item } = migrationData;
      let updatedUser = { ...user };

      if (type === 'flashcard') {
          // Copy PersonalFlashcardSet
          const newItem = { ...item, id: uuid(), name: `${item.name} (Cópia)` };
          const currentTargetSets = updatedUser.personalFlashcardSets?.[targetGoalId] || [];
          updatedUser.personalFlashcardSets = {
              ...updatedUser.personalFlashcardSets,
              [targetGoalId]: [...currentTargetSets, newItem]
          };
      } else if (type === 'mindmap') {
          // Copy PersonalMindMap
          const newItem = { ...item, id: uuid(), name: `${item.name} (Cópia)`, createdAt: new Date().toISOString() };
          const currentTargetMaps = updatedUser.personalMindMaps?.[targetGoalId] || [];
          updatedUser.personalMindMaps = {
              ...updatedUser.personalMindMaps,
              [targetGoalId]: [...currentTargetMaps, newItem]
          };
      } else if (type === 'note') {
          // Copy PersonalNote
          const newItem = { ...item, id: uuid(), title: `${item.title} (Cópia)`, updatedAt: new Date().toISOString() };
          const currentTargetNotes = updatedUser.personalNotes?.[targetGoalId] || [];
          updatedUser.personalNotes = {
              ...updatedUser.personalNotes,
              [targetGoalId]: [...currentTargetNotes, newItem]
          };
      }

      onUpdateUser(updatedUser);
      await saveUserToDB(updatedUser);
      setMigrationData(null);
      alert("Arquivo copiado com sucesso para o outro plano!");
  };

  const togglePackExpand = (packId: string) => { setExpandedPackIds(prev => prev.includes(packId) ? prev.filter(id => id !== packId) : [...prev, packId]); };
  const handleSimuladoFinished = async (result: SimuladoAttempt) => { await saveSimuladoAttemptToDB(result); setAttempts(prev => [...prev, result]); setAllAttempts(prev => [...prev, result]); };
  const toggleGroupAccordion = (groupId: string) => { setExpandedGroups(prev => prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]); };
  const toggleEditalDisc = (id: string) => { setEditalExpanded(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]); };
  const toggleEditalSubGoals = (goalId: string) => { setEditalSubGoalsExpanded(prev => prev.includes(goalId) ? prev.filter(id => id !== goalId) : [...prev, goalId]); };
  const handleSaveNote = async (note: PersonalNote) => { if (!activeNotebookGoalId) return; const goalId = activeNotebookGoalId.id; const currentNotes = user.personalNotes?.[goalId] || []; const noteIndex = currentNotes.findIndex(n => n.id === note.id); let updatedNotes = [...currentNotes]; if (noteIndex >= 0) { updatedNotes[noteIndex] = note; } else { updatedNotes.push(note); } const updatedUser: User = { ...user, personalNotes: { ...(user.personalNotes || {}), [goalId]: updatedNotes } }; onUpdateUser(updatedUser); await saveUserToDB(updatedUser); };
  const handleDeleteNote = (noteId: string) => { if (!activeNotebookGoalId) return; setConfirmModal({ isOpen: true, title: "Excluir Anotação?", message: "Deseja realmente excluir esta anotação? Esta ação não pode ser desfeita.", onConfirm: async () => { const goalId = activeNotebookGoalId.id; const currentNotes = user.personalNotes?.[goalId] || []; const updatedNotes = currentNotes.filter(n => n.id !== noteId); const updatedUser: User = { ...user, personalNotes: { ...(user.personalNotes || {}), [goalId]: updatedNotes } }; onUpdateUser(updatedUser); await saveUserToDB(updatedUser); setConfirmModal(null); } }); };
  
  const handleAdvanceCheck = () => {
      const todayStr = getTodayStr();
      const dayName = getDayName(todayStr);
      const routineMin = user.routine?.days?.[dayName] || 0;
      
      const usedMin = Math.floor(dailySessionSeconds / 60);
      const remainingMin = Math.max(0, routineMin - usedMin);

      if (remainingMin === 0) {
           setConfirmModal({
               isOpen: true,
               title: "Tempo Esgotado",
               message: "Você já utilizou todo o tempo disponível para hoje (conforme o cronômetro). Não é possível adiantar metas.",
               onConfirm: () => setConfirmModal(null)
           });
           return;
      }

      const sortedDates = Object.keys(schedule).sort();
      let nextItem: ScheduledItem | null = null;
      for (const dateKey of sortedDates) { // FIXED: 'of' iterates values, 'in' iterated indices
          if (dateKey > todayStr && schedule[dateKey] && schedule[dateKey].length > 0) {
              nextItem = schedule[dateKey][0];
              break;
          }
      }

      if (!nextItem) {
          setConfirmModal({
               isOpen: true,
               title: "Sem Metas Futuras",
               message: "Não há mais metas futuras agendadas no plano para adiantar.",
               onConfirm: () => setConfirmModal(null)
           });
          return;
      }

      if (Math.ceil(nextItem.duration) > remainingMin) {
          setAdvanceMode(false);
          setConfirmModal({
               isOpen: true,
               title: "Tempo Insuficiente",
               message: `O tempo livre restante de hoje (${remainingMin} min) não é suficiente para a próxima meta:\n\n"${nextItem.title}" (${nextItem.duration} min).\n\nNão é possível adiantar.`,
               onConfirm: () => setConfirmModal(null)
           });
      } else {
          setConfirmModal({
               isOpen: true,
               title: "Adiantar Metas?",
               message: `Você ainda tem ${remainingMin} min livres hoje.\n\nA próxima meta "${nextItem.title}" (${nextItem.duration} min) cabe no seu tempo.\n\nDeseja adiantar e incluí-la na agenda de hoje?`,
               onConfirm: () => {
                   setAdvanceMode(true);
                   setConfirmModal(null);
               }
           });
      }
  };

  const renderDailyView = () => {
      const dayScheduleRaw = schedule[selectedDate] || [];
      const daySchedule = groupScheduleItems(dayScheduleRaw);
      const isToday = selectedDate === getTodayStr();
      const dayName = getDayName(selectedDate);
      const todayStr = getTodayStr();
      const allCompleted = daySchedule.length > 0 && daySchedule.every(g => g.completed);
      const hasTimeAvailableToday = user.routine?.days?.[getDayName(todayStr)] > 0;
      
      const lateItemsRaw = Object.entries(schedule).filter(([date]) => date < todayStr).flatMap(([_, items]) => (items as ScheduledItem[]).filter(item => !item.completed));
      const lateGoalsRaw = lateItemsRaw.filter(i => !i.isRevision);
      const lateRevisionsRaw = lateItemsRaw.filter(i => i.isRevision);
      const lateGoalsGroups = groupScheduleItems(lateGoalsRaw);
      const lateRevisionsGroups = groupScheduleItems(lateRevisionsRaw);
      
      return (
          <div className="w-full animate-fade-in space-y-6">
              {lateGoalsGroups.length > 0 && (
                  <div className="bg-red-900/10 border border-red-500/30 rounded-2xl p-6 mb-4 shadow-[0_0_30px_rgba(255,31,31,0.05)]">
                      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                          <div><h3 className="text-xl font-black text-red-500 uppercase flex items-center gap-2"><Icon.Clock className="w-5 h-5"/> Metas de Ciclo em Atraso</h3><p className="text-xs text-gray-400 mt-1 font-bold uppercase tracking-wider">Você possui {lateGoalsGroups.length} blocos de conteúdo pendentes.</p></div>
                          <button onClick={() => handlePlanAction('reschedule')} className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-black text-xs uppercase shadow-neon transition-all transform hover:scale-[1.02] flex items-center gap-2 shrink-0"><Icon.RefreshCw className="w-4 h-4"/> REPLANEJAR CICLO</button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 opacity-90">
                          {lateGoalsGroups.map((group) => { const goalColor = group.goalType === 'SIMULADO' ? '#3B82F6' : (group.originalGoal?.color || '#FF1F1F'); return ( <div key={group.goalId} className={`relative bg-[#0A0A0A] rounded-xl border-l-4 overflow-hidden border border-[#333]`} style={{ borderLeftColor: goalColor }}> <div className="p-3 flex items-start gap-3 h-full"> <div onClick={() => toggleGoalComplete(group.goalId)} className={`shrink-0 w-5 h-5 rounded-full border flex items-center justify-center cursor-pointer transition ${group.completed ? 'bg-green-500 border-green-500 text-black' : 'border-gray-600 hover:border-white'}`}> {group.completed && <Icon.Check className="w-3 h-3" />} </div> <div className="flex-1 min-w-0"> <span className="text-[8px] font-bold bg-white/5 px-1.5 py-0.5 rounded text-gray-500 uppercase block w-fit mb-1">{group.goalType}</span> <h3 className="font-bold text-sm leading-tight truncate text-white">{group.title}</h3> <p className="text-[9px] text-gray-500 truncate" style={{ color: goalColor }}>{group.disciplineName}</p> </div> </div> </div> ); })}
                      </div>
                  </div>
              )}
              {lateRevisionsGroups.length > 0 && (
                  <div className="bg-cyan-900/10 border border-cyan-500/30 rounded-2xl p-6 mb-10 shadow-[0_0_30px_rgba(6,182,212,0.05)]">
                      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                          <div><h3 className="text-xl font-black text-cyan-500 uppercase flex items-center gap-2"><Icon.RefreshCw className="w-5 h-5"/> Revisões Espaçadas em Atraso</h3><p className="text-xs text-gray-400 mt-1 font-bold uppercase tracking-wider">{lateRevisionsGroups.length} revisões essenciais para a sua memorização.</p></div>
                          <button onClick={() => handlePlanAction('reschedule')} className="bg-cyan-600 hover:bg-cyan-700 text-white px-6 py-3 rounded-lg font-black text-xs uppercase shadow-neon transition-all transform hover:scale-[1.02] flex items-center gap-2 shrink-0"><Icon.RefreshCw className="w-4 h-4"/> REPLANEJAR REVISÕES</button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 opacity-90">
                          {lateRevisionsGroups.map((group) => ( <div key={group.goalId} className={`relative bg-[#0A0A0A] rounded-xl border-l-4 overflow-hidden border border-[#333] border-l-cyan-500`}> <div className="p-3 flex items-start gap-3 h-full"> <div onClick={() => toggleGoalComplete(group.goalId)} className={`shrink-0 w-5 h-5 rounded-full border flex items-center justify-center cursor-pointer transition ${group.completed ? 'bg-green-500 border-green-500 text-black' : 'border-gray-600 hover:border-white'}`}> {group.completed && <Icon.Check className="w-3 h-3" />} </div> <div className="flex-1 min-w-0"> <span className="text-[8px] font-bold bg-cyan-900/20 px-1.5 py-0.5 rounded text-cyan-400 uppercase block w-fit mb-1">REVISÃO</span> <h3 className="font-bold text-sm leading-tight truncate text-white">{group.title}</h3> <p className="text-[9px] text-cyan-600 truncate uppercase font-bold">{group.disciplineName}</p> </div> </div> </div> ))}
                      </div>
                  </div>
              )}
              {isToday && allCompleted && ( <div className="bg-green-900/20 border border-green-500/50 p-8 rounded-2xl text-center space-y-4 animate-fade-in"> <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto border border-green-500/30"> <Icon.Check className="w-10 h-10 text-green-500" /> </div> <div> <h3 className="text-2xl font-black text-white uppercase tracking-tight">Missão Cumprida!</h3> <p className="text-gray-400 text-sm max-w-md mx-auto mt-2">Parabéns pela sua disciplina e esforço aplicado hoje. Você concluuiu todas as metas programadas com sucesso!</p> </div> {!advanceMode && hasTimeAvailableToday && !dismissAdvance && ( <div className="pt-4 border-t border-green-500/20 mt-4"> <p className="text-xs text-green-400 font-bold uppercase tracking-wider mb-4">Você ainda possui tempo disponível para estudar hoje. Gostaria de adiantar metas de estudos?</p> <div className="flex justify-center gap-4"><button onClick={() => setDismissAdvance(true)} className="text-[10px] text-gray-500 hover:text-white uppercase font-bold tracking-widest transition border border-gray-700 px-4 py-2 rounded"> NÃO, POR HOJE É SÓ </button><button onClick={handleAdvanceCheck} className="bg-green-600 hover:bg-green-500 text-white px-8 py-2 rounded font-black text-xs uppercase shadow-lg transition-all transform hover:scale-[1.03]"> SIM, ADIANTAR </button></div> </div> )} {advanceMode && ( <button onClick={() => setAdvanceMode(false)} className="text-[10px] text-gray-500 hover:text-white uppercase font-bold tracking-widest transition mt-4"> Voltar ao cronograma original </button> )} </div> )}
              
              <div className="flex justify-between items-end border-b border-[#333] pb-4"> <div> <h2 className="text-4xl font-black text-white uppercase tracking-tight">{isToday ? 'HOJE' : formatDate(selectedDate)}</h2> <p className="text-insanus-red font-mono text-sm uppercase">{WEEKDAYS.find(w => w.key === dayName)?.label}</p> </div> <div className="text-right"> <div className="text-3xl font-black text-white">{daySchedule.length}</div> <div className="text-[10px] text-gray-500 uppercase font-bold">Metas</div> </div> </div>
              {daySchedule.length === 0 ? ( <div className="text-center py-20 text-gray-600 italic">Nada agendado para hoje.</div> ) : ( <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4"> {daySchedule.flatMap((group) => { const goalColor = group.goalType === 'SIMULADO' ? '#3B82F6' : (group.isRevisionItem ? '#06b6d4' : (group.originalGoal?.color || '#FF1F1F')); const isGroupActive = activeGoalId === group.goalId; const isExpanded = expandedGroups.includes(`${selectedDate}_${group.goalId}`) || isGroupActive; 
                    if (group.goalType === 'SIMULADO') { return [ <div key={group.goalId} className={`bg-blue-900/10 border border-blue-500 rounded-xl p-6 relative overflow-hidden group hover:bg-blue-900/20 transition-all ${group.completed ? 'opacity-60' : ''}`}> <div className="absolute top-0 left-0 w-2 h-full bg-blue-500"></div> <div className="flex justify-between items-start"> <div> <div className="flex items-center gap-2 mb-2"> <span className="bg-blue-500 text-white text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider">SIMULADO</span> {group.completed && <span className="bg-green-500 text-black text-[10px] font-bold px-2 py-1 rounded uppercase">CONCLUÍDO</span>} </div> <h3 className={`text-2xl font-black text-white mb-1 truncate ${group.completed ? 'line-through' : ''}`}>{group.title}</h3> <p className="text-gray-400 text-sm">{group.subjectName}</p> </div> <Icon.List className="w-10 h-10 text-blue-500 opacity-20 group-hover:opacity-50 transition-opacity"/> </div> <button onClick={() => setActiveSimulado(group.simuladoData || null)} className="mt-6 w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-lg font-bold text-sm uppercase shadow-lg transition-all transform hover:scale-[1.02] flex items-center justify-center gap-2"> <Icon.Play className="w-4 h-4"/> {group.completed ? 'VER RESULTADO' : 'REALIZAR AGORA'} </button> </div> ]; } 
                    if (group.goalType === 'AULA') {
                        return [ <div key={group.goalId} className={`relative bg-[#121212] rounded-xl border-l-4 transition-all duration-200 overflow-hidden ${group.completed ? 'border-green-500 opacity-60' : isGroupActive ? 'border-yellow-500 bg-yellow-900/05 ring-1 ring-yellow-500/30 shadow-2xl' : 'hover:bg-[#151515] border-[#333]'}`} style={{ borderLeftColor: group.completed ? undefined : isGroupActive ? '#EAB308' : goalColor }}> <div className="p-4 border border-[#333] rounded-r-xl border-l-0 h-full flex flex-col"> <div className="flex items-start gap-4 mb-4"> <div onClick={() => toggleGoalComplete(group.goalId)} className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center cursor-pointer transition ${group.completed ? 'bg-green-500 border-green-500 text-black' : 'border-gray-600 hover:border-white'}`}> {group.completed && <Icon.Check className="w-4 h-4" />} </div> <div className="flex-1 min-w-0"> <div className="flex justify-between items-start mb-1"> <span className="text-[10px] font-bold bg-white/10 px-2 py-0.5 rounded text-gray-300 uppercase">{group.goalType}</span> <span className="text-[10px] font-mono text-gray-500">{group.totalDuration} min</span> </div> <h3 className={`font-bold text-lg leading-tight truncate ${group.completed ? 'line-through text-gray-500' : 'text-white'}`}>{group.title}</h3> <p className="text-xs font-bold truncate mt-1" style={{ color: isGroupActive ? '#EAB308' : goalColor }}>{group.disciplineName}</p> </div> </div> <button onClick={() => toggleGroupAccordion(`${selectedDate}_${group.goalId}`)} className="flex items-center justify-between p-2 rounded bg-black/30 border border-white/5 text-[10px] font-bold text-gray-400 hover:text-white transition uppercase"> <span className="flex items-center gap-2"> <Icon.Play className="w-3 h-3 text-insanus-red"/> {group.originalGoal?.subGoals?.length || 0} Aulas nesta Meta </span> <Icon.ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}/> </button> {isExpanded && ( <div className="mt-2 space-y-1 animate-fade-in pl-1 border-l-2 border-insanus-red/30"> {group.originalGoal?.subGoals?.map((sub, idx) => { const isSubActive = activeGoalId === group.goalId && activeSubGoalId === sub.id; const isSubCompleted = (user.progress.completedGoalIds as string[]).includes(`${group.goalId}:${sub.id}`); 
                        const isScheduledForToday = group.items.some(scheduledItem => scheduledItem.subGoalId === sub.id); 
                        return ( <div key={sub.id} className={`flex items-center justify-between p-2 rounded-lg transition ${isSubActive ? 'bg-yellow-900/10 border border-yellow-500/30' : 'hover:bg-white/5'} ${isSubCompleted ? 'opacity-40' : ''}`}> <div className="flex items-center gap-2 text-xs truncate mr-2 flex-1"> <span className="text-[9px] font-mono text-gray-600 shrink-0">{idx + 1}.</span> {sub.link ? ( <a href={sub.link} target="_blank" rel="noreferrer" className={`truncate hover:underline flex items-center gap-1.5 transition-colors ${isSubCompleted ? 'line-through text-gray-500' : isSubActive ? 'text-yellow-500 font-bold' : 'text-gray-300 hover:text-white'}`}> {sub.title} <Icon.Link className="w-2.5 h-2.5 opacity-40 shrink-0"/> </a> ) : ( <span className={`truncate ${isSubCompleted ? 'line-through text-gray-500' : isSubActive ? 'text-yellow-500 font-bold' : 'text-gray-300'}`}> {sub.title} </span> )} {isScheduledForToday && !isSubCompleted && (<span className="text-[8px] font-bold bg-insanus-red text-white px-2 py-0.5 rounded uppercase tracking-wider shadow-neon animate-pulse">AGENDADO PARA HOJE</span>)} </div> <div className="flex items-center gap-1 shrink-0"> {isSubActive ? ( <div className="flex items-center gap-1 bg-black p-1 rounded-lg border border-white/10 shadow-lg"> <span className="text-yellow-500 font-mono font-bold text-[10px] px-1">{formatStopwatch(timerSeconds)}</span> <button onClick={(e) => { e.stopPropagation(); isTimerRunning ? pauseTimer() : setIsTimerRunning(true); }} className="w-6 h-6 flex items-center justify-center rounded bg-yellow-600 text-white">{isTimerRunning ? <Icon.Pause className="w-3 h-3"/> : <Icon.Play className="w-3 h-3"/>}</button> <button onClick={(e) => { e.stopPropagation(); saveStudyTime(false); }} className="w-6 h-6 flex items-center justify-center rounded bg-blue-600 text-white"><Icon.Check className="w-3 h-3"/></button> </div> ) : !isSubCompleted && ( <button onClick={(e) => { e.stopPropagation(); startTimer(group.goalId, sub.id); }} disabled={!!activeGoalId} className={`w-6 h-6 flex items-center justify-center rounded transition ${!!activeGoalId ? 'opacity-20' : 'bg-white/5 hover:bg-insanus-red text-gray-500 hover:text-white border border-white/10'}`}> <Icon.Play className="w-2.5 h-2.5"/> </button> )} {isSubCompleted && <Icon.Check className="w-4 h-4 text-green-500" />} </div> </div> ); })} </div> )} <div className="mt-4 flex flex-wrap gap-2 pt-4 border-t border-white/5"> {group.originalGoal?.pdfUrl && ( <button onClick={() => openWatermarkedPDF(group.originalGoal!.pdfUrl!, user)} className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 px-2 py-1 rounded text-[8px] font-black uppercase text-gray-400 transition hover:text-white"><Icon.FileText className="w-2.5 h-2.5 text-insanus-red"/> PDF</button> )} {group.originalGoal?.pdfUrls?.map((pdf, pidx) => ( <button key={pidx} onClick={() => openWatermarkedPDF(pdf.url, user)} className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 px-2 py-1 rounded text-[8px] font-black uppercase text-gray-400 transition hover:text-white"><Icon.FileText className="w-2.5 h-2.5 text-insanus-red"/> {pdf.name.slice(0, 8)}...</button> ))} {group.originalGoal?.link && (<a href={group.originalGoal.link} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 px-2 py-1 rounded text-[8px] font-black uppercase text-gray-400 transition hover:text-white no-underline"><Icon.Link className="w-2.5 h-2.5 text-blue-500"/> LINK</a>)} {group.originalGoal?.links?.map((link, lidx) => ( <a key={lidx} href={link.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 px-2 py-1 rounded text-[8px] font-black uppercase text-gray-400 transition hover:text-white no-underline"> <Icon.Link className="w-2.5 h-2.5 text-blue-500"/> {link.name} </a> ))} 
                                    {group.originalGoal?.flashcards && group.originalGoal.flashcards.length > 0 && ( <button onClick={() => setActiveFlashcards(group.originalGoal!.flashcards!)} className="flex items-center gap-1.5 bg-blue-600/10 hover:bg-blue-600/30 border border-blue-600/30 px-2 py-1 rounded text-[8px] font-black uppercase text-blue-400"><Icon.RefreshCw className="w-2.5 h-2.5"/> FLASHCARDS</button> )} 
                                    {group.originalGoal?.generatedMindMap && (
                                        <button onClick={() => setActiveMindMapNode(group.originalGoal!.generatedMindMap!)} className="flex items-center gap-1.5 bg-purple-600/10 hover:bg-purple-600/30 border border-purple-600/30 px-2 py-1 rounded text-[8px] font-black uppercase text-purple-400 transition">
                                            <Icon.Share2 className="w-2.5 h-2.5"/> MAPA MENTAL (IA)
                                        </button>
                                    )}
                                    {user.personalMindMaps?.[group.goalId]?.map(map => (
                                        <button key={map.id} onClick={() => { setActiveMindMapNode(map.root); setActivePersonalMindMap(map); }} className="flex items-center gap-1.5 bg-purple-600/10 hover:bg-purple-600/30 border border-purple-600/30 px-2 py-1 rounded text-[8px] font-black uppercase text-purple-400 transition">
                                            <Icon.Share2 className="w-2.5 h-2.5"/> MAPA: {map.name}
                                        </button>
                                    ))}
                                </div> 
                            </div> 
                        </div> 
                    ]; 
                    }
                    
                    // GENERIC CARD FOR OTHER TYPES (Material, Questões, Lei Seca, Resumo, Revisão)
                    return [
                        <div key={group.goalId} className={`relative bg-[#121212] rounded-xl border-l-4 transition-all duration-200 overflow-hidden ${group.completed ? 'border-green-500 opacity-60' : isGroupActive ? 'border-yellow-500 bg-yellow-900/05 ring-1 ring-yellow-500/30 shadow-2xl' : 'hover:bg-[#151515] border-[#333]'}`} style={{ borderLeftColor: group.completed ? undefined : isGroupActive ? '#EAB308' : goalColor }}>
                            <div className="p-4 border border-[#333] rounded-r-xl border-l-0 h-full flex flex-col">
                                <div className="flex items-start gap-4 mb-4">
                                    <div onClick={() => toggleGoalComplete(group.goalId)} className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center cursor-pointer transition ${group.completed ? 'bg-green-500 border-green-500 text-black' : 'border-gray-600 hover:border-white'}`}>
                                        {group.completed && <Icon.Check className="w-4 h-4" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-start mb-1">
                                            <span className="text-[10px] font-bold bg-white/10 px-2 py-0.5 rounded text-gray-300 uppercase">{group.goalType.replace('_', ' ')}</span>
                                            <span className="text-[10px] font-mono text-gray-500">{group.totalDuration} min</span>
                                        </div>
                                        <h3 className={`font-bold text-lg leading-tight truncate ${group.completed ? 'line-through text-gray-500' : 'text-white'}`}>{group.title}</h3>
                                        <p className="text-xs font-bold truncate mt-1" style={{ color: isGroupActive ? '#EAB308' : goalColor }}>{group.disciplineName}</p>
                                    </div>
                                </div>

                                {/* Timer controls for generic items */}
                                {!group.completed && (
                                    <div className="flex items-center gap-2 mb-4">
                                         {isGroupActive ? (
                                            <div className="flex items-center gap-1 bg-black p-1 rounded-lg border border-white/10 shadow-lg w-full justify-center">
                                                <span className="text-yellow-500 font-mono font-bold text-xs px-2">{formatStopwatch(timerSeconds)}</span>
                                                <button onClick={(e) => { e.stopPropagation(); isTimerRunning ? pauseTimer() : setIsTimerRunning(true); }} className="w-8 h-8 flex items-center justify-center rounded bg-yellow-600 text-white">{isTimerRunning ? <Icon.Pause className="w-4 h-4"/> : <Icon.Play className="w-4 h-4"/>}</button>
                                                <button onClick={(e) => { e.stopPropagation(); saveStudyTime(true); }} className="w-8 h-8 flex items-center justify-center rounded bg-blue-600 text-white"><Icon.Check className="w-4 h-4"/></button>
                                            </div>
                                         ) : (
                                            <button onClick={(e) => { e.stopPropagation(); startTimer(group.goalId); }} disabled={!!activeGoalId} className={`w-full py-2 flex items-center justify-center rounded transition font-bold text-xs uppercase ${!!activeGoalId ? 'opacity-20 cursor-not-allowed bg-white/5' : 'bg-white/5 hover:bg-insanus-red text-gray-400 hover:text-white border border-white/10'}`}>
                                                <Icon.Play className="w-3 h-3 mr-2"/> Iniciar Estudo
                                            </button>
                                         )}
                                    </div>
                                )}

                                <div className="mt-auto flex flex-wrap gap-2 pt-4 border-t border-white/5">
                                    {group.originalGoal?.pdfUrl && ( <button onClick={() => openWatermarkedPDF(group.originalGoal!.pdfUrl!, user)} className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 px-2 py-1 rounded text-[8px] font-black uppercase text-gray-400 transition hover:text-white"><Icon.FileText className="w-2.5 h-2.5 text-insanus-red"/> PDF</button> )}
                                    {group.originalGoal?.pdfUrls?.map((pdf, pidx) => ( <button key={pidx} onClick={() => openWatermarkedPDF(pdf.url, user)} className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 px-2 py-1 rounded text-[8px] font-black uppercase text-gray-400 transition hover:text-white"><Icon.FileText className="w-2.5 h-2.5 text-insanus-red"/> {pdf.name.slice(0, 8)}...</button> ))}
                                    {group.originalGoal?.link && (<a href={group.originalGoal.link} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 px-2 py-1 rounded text-[8px] font-black uppercase text-gray-400 transition hover:text-white no-underline"><Icon.Link className="w-2.5 h-2.5 text-blue-500"/> LINK</a>)}
                                    {group.originalGoal?.links?.map((link, lidx) => ( <a key={lidx} href={link.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 px-2 py-1 rounded text-[8px] font-black uppercase text-gray-400 transition hover:text-white no-underline"> <Icon.Link className="w-2.5 h-2.5 text-blue-500"/> {link.name} </a> ))}
                                    {group.originalGoal?.flashcards && group.originalGoal.flashcards.length > 0 && ( <button onClick={() => setActiveFlashcards(group.originalGoal!.flashcards!)} className="flex items-center gap-1.5 bg-blue-600/10 hover:bg-blue-600/30 border border-blue-600/30 px-2 py-1 rounded text-[8px] font-black uppercase text-blue-400"><Icon.RefreshCw className="w-2.5 h-2.5"/> FLASHCARDS</button> )}
                                    {group.originalGoal?.generatedMindMap && (
                                        <button onClick={() => setActiveMindMapNode(group.originalGoal!.generatedMindMap!)} className="flex items-center gap-1.5 bg-purple-600/10 hover:bg-purple-600/30 border border-purple-600/30 px-2 py-1 rounded text-[8px] font-black uppercase text-purple-400 transition">
                                            <Icon.Share2 className="w-2.5 h-2.5"/> MAPA MENTAL (IA)
                                        </button>
                                    )}
                                    {user.personalMindMaps?.[group.goalId]?.map(map => (
                                        <button key={map.id} onClick={() => setActiveMindMapNode(map.root)} className="flex items-center gap-1.5 bg-purple-600/10 hover:bg-purple-600/30 border border-purple-600/30 px-2 py-1 rounded text-[8px] font-black uppercase text-purple-400 transition">
                                            <Icon.Share2 className="w-2.5 h-2.5"/> MAPA: {map.name}
                                        </button>
                                    ))}
                                    
                                    {/* QUESTOES Notebook Button */}
                                    {group.goalType === 'QUESTOES' && (
                                        <button onClick={() => setActiveNotebookGoalId({ id: group.goalId, title: group.title })} className="flex items-center gap-1.5 bg-insanus-red/10 hover:bg-insanus-red/30 border border-insanus-red/30 px-2 py-1 rounded text-[8px] font-black uppercase text-insanus-red hover:text-white transition">
                                            <Icon.Edit className="w-2.5 h-2.5"/> Caderno
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ];
                    
                    })} </div> )}
          </div>
      );
  };
  
  const renderCalendarView = () => {
      const todayStr = getTodayStr();
      
      const [year, month] = selectedDate.split('-').map(Number);
      const dateObj = new Date(year, month - 1, 1);
      const monthName = dateObj.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
      
      const firstDayOfWeek = dateObj.getDay(); 
      const daysInMonth = new Date(year, month, 0).getDate();
      
      const calendarCells = [];
      // Empty slots for padding
      for(let i=0; i<firstDayOfWeek; i++) {
          calendarCells.push(null);
      }
      // Actual days
      for(let i=1; i<=daysInMonth; i++) {
          calendarCells.push(`${year}-${String(month).padStart(2,'0')}-${String(i).padStart(2,'0')}`);
      }

      const weekDates = getWeekDays(selectedDate);

      return (
          <div className="w-full animate-fade-in h-[calc(100vh-100px)] flex flex-col">
               <div className="flex justify-between items-center border-b border-[#333] pb-6 shrink-0"> 
                  <div> 
                      <h2 className="text-3xl font-black text-white uppercase">
                        {calendarMode === 'week' ? 'CALENDÁRIO' : monthName.toUpperCase()}
                      </h2> 
                      <p className="text-xs text-insanus-red font-bold uppercase tracking-widest">Visualização {calendarMode === 'week' ? 'Semanal' : 'Mensal'}</p> 
                  </div> 
                  <div className="flex items-center gap-4"> 
                      <div className="flex bg-[#121212] rounded-lg p-1 border border-[#333]"> 
                          <button onClick={() => setCalendarMode('week')} className={`px-4 py-2 text-xs font-bold rounded transition-all ${calendarMode === 'week' ? 'bg-insanus-red text-white shadow-neon' : 'text-gray-400 hover:text-white'}`}>SEMANAL</button> 
                          <button onClick={() => setCalendarMode('month')} className={`px-4 py-2 text-xs font-bold rounded transition-all ${calendarMode === 'month' ? 'bg-insanus-red text-white shadow-neon' : 'text-gray-400 hover:text-white'}`}>MENSAL</button> 
                      </div> 
                      <div className="flex gap-1 bg-[#121212] rounded-lg border border-[#333] p-1"> 
                          <button onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() - (calendarMode === 'week' ? 7 : 30)); const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0'); setSelectedDate(`${y}-${m}-${day}`); }} className="p-2 hover:bg-white/10 rounded text-white transition"><Icon.ArrowUp className="-rotate-90 w-4 h-4" /></button> 
                          <button onClick={() => setSelectedDate(getTodayStr())} className="px-3 py-2 hover:bg-white/10 rounded text-[10px] font-bold text-white uppercase transition border-x border-white/5">Hoje</button> 
                          <button onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() + (calendarMode === 'week' ? 7 : 30)); const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0'); setSelectedDate(`${y}-${m}-${day}`); }} className="p-2 hover:bg-white/10 rounded text-white transition"><Icon.ArrowDown className="-rotate-90 w-4 h-4" /></button> 
                      </div> 
                  </div> 
               </div>
              <div className="grid grid-cols-7 gap-2 mb-2 mt-4 text-center shrink-0"> {WEEKDAYS.map(d => <div key={d.key} className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{d.label.split('-')[0]}</div>)} </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                  {calendarMode === 'week' ? (
                      <div className="grid grid-cols-7 gap-2 h-full min-h-[600px]"> {weekDates.map(dateStr => { const rawItems = schedule[dateStr] || []; const items = groupScheduleItems(rawItems); const isSelected = selectedDate === dateStr; const isToday = dateStr === getTodayStr(); const hasLateGoals = dateStr < getTodayStr() && items.some(i => !i.completed); return ( <div key={dateStr} onClick={() => { setSelectedDate(dateStr); setView('daily'); }} className={`rounded-xl border flex flex-col transition-all cursor-pointer h-full bg-[#121212] ${isSelected ? 'bg-[#1E1E1E] border-insanus-red shadow-[inset_0_0_20px_rgba(255,31,31,0.1)]' : 'border-[#333] hover:border-[#555] hover:bg-[#1A1A1A]'} ${isToday ? 'ring-1 ring-insanus-red ring-offset-2 ring-offset-black' : ''} ${hasLateGoals ? 'border-red-500/50 bg-red-900/10' : ''}`}> <div className={`text-center p-3 border-b border-[#333] ${isToday ? 'bg-insanus-red text-white' : 'bg-[#1A1A1A]'} relative`}> <div className="text-2xl font-black">{dateStr.split('-')[2]}</div> {hasLateGoals && <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500 shadow-[0_0_5px_red] animate-pulse"></div>} </div> <div className="flex-1 p-2 space-y-2 overflow-y-auto custom-scrollbar"> {items.flatMap((group, i) => { const goalColor = group.goalType === 'SIMULADO' ? '#3B82F6' : (group.isRevisionItem ? '#06b6d4' : (group.originalGoal?.color || '#FF1F1F')); if (group.goalType === 'AULA') { const isExpandedInCalendar = expandedGroups.includes(`cal_${dateStr}_${group.goalId}`) || (activeGoalId === group.goalId); return [ <div key={i} className={`p-2 rounded-lg border-l-4 bg-black/60 shadow-lg transition-all ${group.completed ? 'opacity-50' : ''} border border-white/5`} style={{ borderLeftColor: goalColor }}> <div className="flex justify-between items-start"> <span className="text-[8px] font-black uppercase tracking-widest truncate max-w-[80%]" style={{ color: goalColor }}>{group.disciplineName}</span> {group.completed && <Icon.Check className="w-2 h-2 text-green-500" />} </div> <div className="text-[10px] font-bold text-white line-clamp-2 my-1 leading-tight">{group.title}</div> <button onClick={(e) => { e.stopPropagation(); toggleGroupAccordion(`cal_${dateStr}_${group.goalId}`); }} className="w-full flex items-center justify-between text-[7px] text-gray-500 hover:text-white uppercase font-black pt-1 border-t border-white/5"> <span>{group.items.length > 1 ? `${group.items.length} AULAS` : '1 AULA'}</span> <Icon.ChevronDown className={`w-2 h-2 transition-transform ${isExpandedInCalendar ? 'rotate-180' : ''}`}/> </button> {isExpandedInCalendar && ( <div className="mt-1 space-y-0.5 animate-fade-in"> {group.items.map((item, idx) => { const subName = group.originalGoal?.subGoals?.find(s => s.id === item.subGoalId)?.title || item.title; return ( <div key={idx} className="flex items-center gap-1 text-[8px] text-gray-400 group/sub"> <div className={`w-1 h-1 rounded-full ${item.completed ? 'bg-green-500' : 'bg-white/20'}`}></div> <span className="truncate">{subName}</span> </div> ); })} </div> )} </div> ]; } 
                      return group.items.map(item => {
                          const revLabel = item.isRevision && item.originalGoal?.revisionIntervals ? (() => {
                               const intervals = item.originalGoal.revisionIntervals.split(',').map(s => parseInt(s.trim()));
                               const idx = intervals.indexOf(item.revisionIndex || 0) + 1;
                               return `Rev. ${idx} - ${item.revisionIndex} dias`;
                          })() : null;

                          return ( <div key={item.uniqueId} className={`p-2 rounded-lg border-l-4 bg-black/60 shadow-lg transition-all ${item.completed ? 'opacity-50' : ''} border border-white/5`} style={{ borderLeftColor: goalColor }}> <div className="flex justify-between items-start"> <span className="text-[8px] font-black uppercase tracking-widest truncate max-w-[80%]" style={{ color: goalColor }}>{group.disciplineName}</span> {item.completed && <Icon.Check className="w-2 h-2 text-green-500" />} </div> <div className="text-[10px] font-bold text-white line-clamp-2 my-1 leading-tight">{item.title}</div> {revLabel && <div className="text-[9px] font-mono text-cyan-400 font-bold mt-0.5">{revLabel}</div>} <div className="flex items-center gap-2 mt-1"> <span className="px-1.5 py-0.5 rounded bg-white/5 text-[7px] font-mono text-gray-500">{item.duration}m</span> <span className="text-[7px] uppercase font-black text-gray-700">{item.goalType}</span> </div> </div> );
                      }); })} </div> </div> ); })} </div>
                  ) : (
                      <div className="grid grid-cols-7 gap-2 h-full auto-rows-fr"> 
                        {calendarCells.map((dateStr, index) => { 
                          if (!dateStr) return <div key={`empty-${index}`} className="rounded-lg border border-[#333] bg-[#0A0A0A] opacity-30"></div>;
                          
                          const items = schedule[dateStr] || []; 
                          const groupedItems = groupScheduleItems(items);
                          const isSelected = selectedDate === dateStr; 
                          const isToday = dateStr === getTodayStr(); 
                          const hasLateGoals = dateStr < getTodayStr() && items.some(i => !i.completed); 
                          
                          return ( 
                            <div key={dateStr} onClick={() => { setSelectedDate(dateStr); setView('daily'); }} className={`rounded-lg border p-2 flex flex-col transition-all cursor-pointer hover:bg-[#1A1A1A] min-h-[100px] ${isSelected ? 'bg-[#1E1E1E] border-insanus-red' : 'border-[#333] bg-[#121212]'} ${hasLateGoals ? 'border-red-500/50' : ''}`}> 
                                <div className="flex justify-between items-center mb-1"> 
                                    <div className="flex items-center gap-1"> 
                                        <span className={`text-xs font-bold ${isToday ? 'text-insanus-red bg-insanus-red/10 px-1.5 rounded' : 'text-gray-400'}`}>{dateStr.split('-')[2]}</span> 
                                        {hasLateGoals && <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>} 
                                    </div> 
                                    {items.length > 0 && <span className="text-[9px] text-gray-600 font-mono">{items.length}</span>} 
                                </div> 
                                <div className="flex-1 flex flex-col gap-1 overflow-hidden"> 
                                    {groupedItems.slice(0, 4).map((group, i) => {
                                        const goalColor = group.goalType === 'SIMULADO' ? '#3B82F6' : (group.isRevisionItem ? '#06b6d4' : (group.originalGoal?.color || '#FF1F1F'));
                                        return ( 
                                            <div key={i} className="flex items-center gap-1 bg-white/5 border-l-2 px-1 py-0.5 rounded overflow-hidden" style={{ borderLeftColor: goalColor }}> 
                                                <span className="text-[6px] font-black text-gray-300 truncate uppercase leading-none" style={{ color: group.completed ? '#555' : '#ccc' }}>
                                                    {group.goalType.slice(0,3)} • {group.disciplineName}
                                                </span> 
                                            </div> 
                                        );
                                    })} 
                                    {groupedItems.length > 4 && <span className="text-[7px] text-gray-500 font-bold text-center">+{groupedItems.length - 4} mais</span>}
                                </div> 
                            </div> 
                          ); 
                        })} 
                      </div>
                  )}
              </div>
          </div>
      );
  };

  const renderEditalView = () => {
    if (!currentPlan?.editalVerticalizado || currentPlan.editalVerticalizado.length === 0) {
        return ( <div className="flex flex-col items-center justify-center h-64 text-gray-600 border border-dashed border-[#333] rounded-2xl"><Icon.List className="w-12 h-12 mb-4 opacity-50"/><p>Edital Verticalizado não configurado.</p></div> );
    }

    const canManualComplete = currentPlan.enableActiveUserMode; // CHECK FLAG

    const ORDERED_LINKS = ['aula', 'material', 'questoes', 'leiSeca', 'resumo', 'revisao'];
    const findGoal = (goalId: string) => { for (const d of currentPlan.disciplines) { for (const s of d.subjects) { const g = s.goals.find(g => g.id === goalId); if (g) return g; } } return null; };
    const isLinkDone = (goalId: string) => { if (!goalId) return false; const currentCompletedIds = (user.progress.completedGoalIds as string[]) || []; return currentCompletedIds.includes(goalId); }
    const isSubTopicDone = (st: EditalSubTopic) => { const linkedGoalIds = ORDERED_LINKS.map(type => st.links[type as keyof typeof st.links]).filter(id => !!id) as string[]; if (linkedGoalIds.length === 0) return false; return linkedGoalIds.every(gid => isLinkDone(gid)); }
    const isTopicDone = (t: EditalTopic) => { const linkedGoalIds = ORDERED_LINKS.map(type => t.links[type as keyof typeof t.links]).filter(id => !!id) as string[]; const mainLinksDone = linkedGoalIds.length > 0 && linkedGoalIds.every(gid => isLinkDone(gid)); if (t.subTopics && t.subTopics.length > 0) { const subTopicsDone = t.subTopics.every(st => isSubTopicDone(st)); if (linkedGoalIds.length === 0) return subTopicsDone; return mainLinksDone && subTopicsDone; } if (linkedGoalIds.length === 0) return false; return mainLinksDone; };

    // NEW: Function to toggle entire Topic (Assunto)
    const toggleTopicComplete = async (topic: EditalTopic) => {
        if (!currentPlan) return;
        const allGoalIds: string[] = [];
        
        ORDERED_LINKS.forEach(k => {
            const id = topic.links[k as keyof typeof topic.links];
            if (id) allGoalIds.push(id);
        });

        if (topic.subTopics) {
            topic.subTopics.forEach(st => {
                ORDERED_LINKS.forEach(k => {
                    const id = st.links[k as keyof typeof st.links];
                    if (id) allGoalIds.push(id);
                });
            });
        }

        if (allGoalIds.length === 0) return;

        const atomicIds: string[] = [];
        currentPlan.disciplines.forEach(d => {
            d.subjects.forEach(s => {
                s.goals.forEach(g => {
                    if (allGoalIds.includes(g.id)) {
                        atomicIds.push(g.id);
                        if (g.subGoals) {
                            g.subGoals.forEach(sg => atomicIds.push(`${g.id}:${sg.id}`));
                        }
                    }
                });
            });
        });

        const currentCompleted = user.progress.completedGoalIds || [];
        const isAllDone = atomicIds.every(id => currentCompleted.includes(id));
        
        let newCompleted = [...currentCompleted];
        if (isAllDone) {
            newCompleted = newCompleted.filter(id => !atomicIds.includes(id));
        } else {
            atomicIds.forEach(id => {
                if (!newCompleted.includes(id)) newCompleted.push(id);
            });
        }

        const updatedUser = { ...user, progress: { ...user.progress, completedGoalIds: newCompleted } };
        onUpdateUser(updatedUser);
        await saveUserToDB(updatedUser);
    };

    const toggleSubTopicComplete = async (sub: EditalSubTopic) => {
        if (!currentPlan) return;
        const allGoalIds: string[] = [];
        
        ORDERED_LINKS.forEach(k => {
            const id = sub.links[k as keyof typeof sub.links];
            if (id) allGoalIds.push(id);
        });

        if (allGoalIds.length === 0) return;

        const atomicIds: string[] = [];
        currentPlan.disciplines.forEach(d => {
            d.subjects.forEach(s => {
                s.goals.forEach(g => {
                    if (allGoalIds.includes(g.id)) {
                        atomicIds.push(g.id);
                        if (g.subGoals) {
                            g.subGoals.forEach(sg => atomicIds.push(`${g.id}:${sg.id}`));
                        }
                    }
                });
            });
        });

        const currentCompleted = user.progress.completedGoalIds || [];
        const isAllDone = atomicIds.every(id => currentCompleted.includes(id));
        
        let newCompleted = [...currentCompleted];
        if (isAllDone) {
            newCompleted = newCompleted.filter(id => !atomicIds.includes(id));
        } else {
            atomicIds.forEach(id => {
                if (!newCompleted.includes(id)) newCompleted.push(id);
            });
        }

        const updatedUser = { ...user, progress: { ...user.progress, completedGoalIds: newCompleted } };
        onUpdateUser(updatedUser);
        await saveUserToDB(updatedUser);
    };

    let totalTopics = 0; let completedTopics = 0;
    currentPlan.editalVerticalizado.forEach(disc => { disc.topics.forEach(topic => { totalTopics++; if (isTopicDone(topic)) completedTopics++; if (topic.subTopics) { topic.subTopics.forEach(st => { totalTopics++; if (isSubTopicDone(st)) dTotal++; }); } }); });
    const percentage = totalTopics > 0 ? Math.round((completedTopics / totalTopics) * 100) : 0;

    const renderLinksRow = (links: any) => (
        <div className="flex flex-wrap gap-2 ml-7 mt-1">
            {ORDERED_LINKS.map(type => {
                const goalId = links[type as keyof typeof links];
                if(!goalId) return null;
                const goal = findGoal(goalId as string);
                if(!goal) return null;
                const isGoalDone = (user.progress.completedGoalIds as string[] || []).includes(goal.id);
                const personalSets = user.personalFlashcardSets?.[goal.id] || [];
                const personalNotes = user.personalNotes?.[goal.id] || [];
                const isExpanded = editalSubGoalsExpanded.includes(goal.id);
                let IconComp = type === 'aula' ? Icon.Play : type === 'questoes' ? Icon.Code : type === 'leiSeca' ? Icon.Book : type === 'resumo' ? Icon.Edit : type === 'revisao' ? Icon.RefreshCw : Icon.FileText;

                const revCount = (goal.hasRevision && goal.revisionIntervals) ? (() => {
                     const total = goal.revisionIntervals.split(',').filter(x => x.trim()).length;
                     const done = (user.revisions || []).filter(r => r.sourceGoalId === goal.id && r.completed).length;
                     return `${done}/${total}`;
                })() : null;

                if (type === 'questoes') {
                    return (
                        <div key={type} className={`flex flex-col transition-all duration-200 ${isExpanded ? 'w-full my-2 bg-[#151515] rounded-xl border border-[#333] p-4' : ''}`}>
                            <div className="flex items-center">
                                {canManualComplete && (
                                    <div onClick={(e) => { e.stopPropagation(); toggleGoalComplete(goal.id); }} className={`cursor-pointer w-4 h-4 rounded border flex items-center justify-center mr-2 shrink-0 transition-colors ${isGoalDone ? 'bg-green-500 border-green-500' : 'border-gray-500 hover:border-white'}`} title="Marcar como concluído manualmente">
                                        {isGoalDone && <Icon.Check className="w-3 h-3 text-black"/>}
                                    </div>
                                )}
                                <button onClick={() => toggleEditalSubGoals(goal.id)} className={`flex items-center gap-2 px-2 py-1 rounded border text-[10px] font-bold uppercase transition hover:brightness-125 w-fit ${isGoalDone ? '!border-green-500 !bg-green-500/10 !text-green-500' : ''}`} style={{ borderColor: isGoalDone ? undefined : goal.color || '#333', color: isGoalDone ? undefined : goal.color || '#999' }}>
                                    <IconComp className="w-3 h-3"/> {goal.title} 
                                    {revCount && <span className="text-[8px] bg-cyan-900/40 text-cyan-400 px-1 rounded ml-1 border border-cyan-800">{revCount}</span>}
                                    {personalNotes.length > 0 && <span className="opacity-60 font-mono text-[9px] ml-1">({personalNotes.length} notas)</span>}
                                    <Icon.ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}/>
                                </button>
                            </div>
                            {isExpanded && (
                                <div className="mt-4 space-y-4 animate-fade-in pl-1">
                                    <div className="flex gap-2 flex-wrap">
                                        {goal.link && (
                                            <button onClick={() => window.open(goal.link, '_blank')} className="px-3 py-2 bg-[#1E1E1E] border border-white/10 rounded hover:border-white/30 text-white text-[10px] font-bold uppercase transition flex items-center gap-2">
                                                <Icon.Link className="w-3 h-3 text-blue-500"/> Link Questões
                                            </button>
                                        )}
                                        {goal.links?.map((l, i) => (
                                            <button key={`l-${i}`} onClick={() => window.open(l.url, '_blank')} className="px-3 py-2 bg-[#1E1E1E] border border-white/10 rounded hover:border-white/30 text-white text-[10px] font-bold uppercase transition flex items-center gap-2">
                                                <Icon.Link className="w-3 h-3 text-blue-500"/> {l.name}
                                            </button>
                                        ))}
                                        {goal.pdfUrl && (
                                            <button onClick={() => openWatermarkedPDF(goal.pdfUrl!, user)} className="px-3 py-2 bg-[#1E1E1E] border border-white/10 rounded hover:border-white/30 text-white text-[10px] font-bold uppercase transition flex items-center gap-2">
                                                <Icon.FileText className="w-3 h-3 text-insanus-red"/> PDF Questões
                                            </button>
                                        )}
                                        {goal.pdfUrls?.map((p, i) => (
                                            <button key={`p-${i}`} onClick={() => openWatermarkedPDF(p.url, user)} className="px-3 py-2 bg-[#1E1E1E] border border-white/10 rounded hover:border-white/30 text-white text-[10px] font-bold uppercase transition flex items-center gap-2">
                                                <Icon.FileText className="w-3 h-3 text-insanus-red"/> {p.name}
                                            </button>
                                        ))}
                                    </div>
                                    
                                    <div className="bg-black/20 border border-white/5 p-4 rounded-lg">
                                        <div className="flex justify-between items-center mb-3">
                                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2"><Icon.Edit className="w-3 h-3"/> Caderno de Erros & Anotações</h4>
                                            <button onClick={() => setActiveNotebookGoalId({ id: goal.id, title: goal.title })} className="bg-insanus-red/10 border border-insanus-red/30 text-insanus-red hover:bg-insanus-red hover:text-white px-3 py-1.5 rounded text-[9px] font-bold uppercase transition shadow-neon">
                                                Abrir Caderno
                                            </button>
                                        </div>
                                        {personalNotes.length > 0 ? (
                                            <div className="space-y-2">
                                                {personalNotes.map(n => (
                                                    <div key={n.id} className="flex justify-between items-center text-[9px] bg-[#1A1A1A] border border-white/5 px-2 py-1.5 rounded text-gray-400 group/note">
                                                        <span className="truncate">{n.title}</span>
                                                        <div className="flex items-center gap-2 opacity-0 group-hover/note:opacity-100 transition">
                                                            <button onClick={() => setMigrationData({ type: 'note', item: n })} title="Copiar para outro plano" className="text-gray-500 hover:text-white"><Icon.Copy className="w-3 h-3"/></button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-[9px] text-gray-600 italic">Nenhuma anotação criada para este bloco de questões.</p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                }

                if (type === 'revisao') {
                    return (
                        <div key={type} className={`flex flex-col transition-all duration-200 ${isExpanded ? 'w-full my-2 bg-[#151515] rounded-xl border border-[#333] p-4' : ''}`}>
                            <div className="flex items-center">
                                {canManualComplete && (
                                    <div onClick={(e) => { e.stopPropagation(); toggleGoalComplete(goal.id); }} className={`cursor-pointer w-4 h-4 rounded border flex items-center justify-center mr-2 shrink-0 transition-colors ${isGoalDone ? 'bg-green-500 border-green-500' : 'border-gray-500 hover:border-white'}`} title="Marcar como concluído manualmente">
                                        {isGoalDone && <Icon.Check className="w-3 h-3 text-black"/>}
                                    </div>
                                )}
                                <button onClick={() => toggleEditalSubGoals(goal.id)} className={`flex items-center gap-2 px-2 py-1 rounded border text-[10px] font-bold uppercase transition hover:brightness-125 w-fit ${isGoalDone ? '!border-green-500 !bg-green-500/10 !text-green-500' : ''}`} style={{ borderColor: isGoalDone ? undefined : goal.color || '#333', color: isGoalDone ? undefined : goal.color || '#999' }}>
                                    <IconComp className="w-3 h-3"/> {goal.title} 
                                    {revCount && <span className="text-[8px] bg-cyan-900/40 text-cyan-400 px-1 rounded ml-1 border border-cyan-800">{revCount}</span>}
                                    <span className="opacity-60 font-mono text-[9px] ml-1">({(goal.flashcards?.length || 0) + personalSets.reduce((acc, s) => acc + s.cards.length, 0)} cards)</span> <Icon.ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}/>
                                </button>
                            </div>
                            {isExpanded && (
                                <div className="mt-4 space-y-6 animate-fade-in">
                                    {goal.flashcards && goal.flashcards.length > 0 && (
                                        <div className="space-y-2">
                                            <h4 className="text-[9px] font-black text-gray-500 uppercase tracking-widest border-b border-[#333] pb-1">Conteúdo do Professor</h4>
                                            <button onClick={() => setActiveFlashcards(goal.flashcards!)} className="flex items-center gap-2 px-3 py-2 rounded bg-blue-600/10 border border-blue-600/30 text-[10px] font-bold text-blue-400 uppercase w-full hover:bg-blue-600/20 transition">
                                                <Icon.RefreshCw className="w-3 h-3"/> Abrir Revisão Ativa ({goal.flashcards.length} cards)
                                            </button>
                                        </div>
                                    )}
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center border-b border-[#333] pb-1">
                                            <h4 className="text-[9px] font-black text-cyan-500 uppercase tracking-widest">Meus Conjuntos ({personalSets.length}/3)</h4>
                                            {personalSets.length < 3 && (
                                                <button onClick={() => handlePersonalPackAction(goal.id, 'add')} className="text-[8px] font-black text-white hover:text-cyan-400 transition uppercase">+ Criar Novo Conjunto</button>
                                            )}
                                        </div>
                                         <div className="grid gap-3">
                                            {personalSets.map((set) => {
                                                const isPackExpanded = expandedPackIds.includes(set.id);
                                                return (
                                                    <div key={set.id} className={`bg-black/40 border rounded-xl overflow-hidden transition-all ${isPackExpanded ? 'border-cyan-500/50' : 'border-white/5 hover:border-cyan-500/30'}`}>
                                                        <div className="p-3 flex items-center justify-between bg-white/5 group cursor-pointer" onClick={() => togglePackExpand(set.id)}>
                                                            <div className="flex items-center gap-3 flex-1 overflow-hidden">
                                                                <Icon.ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform ${isPackExpanded ? 'rotate-180' : ''}`} />
                                                                <Icon.Folder className={`w-4 h-4 shrink-0 transition-colors ${isPackExpanded ? 'text-cyan-400' : 'text-cyan-600'}`}/>
                                                                {editingPackId === set.id ? (
                                                                    <input autoFocus value={set.name} onBlur={() => setEditingPackId(null)} onClick={e => e.stopPropagation()} onChange={e => handlePersonalPackAction(goal.id, 'update', { ...set, name: e.target.value })} className="bg-black border border-cyan-500/50 rounded px-2 py-0.5 text-xs text-white outline-none w-full" />
                                                                ) : (
                                                                    <div className="flex items-center gap-2 truncate">
                                                                        <span className={`text-xs font-bold transition-colors ${isPackExpanded ? 'text-white' : 'text-gray-300'}`}>{set.name}</span>
                                                                        <button onClick={e => { e.stopPropagation(); setEditingPackId(set.id); }} className="text-gray-600 hover:text-white opacity-0 group-hover:opacity-100 transition"><Icon.Edit className="w-3 h-3"/></button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-2 shrink-0 ml-4" onClick={e => e.stopPropagation()}>
                                                                <button onClick={() => setMigrationData({ type: 'flashcard', item: set })} className="text-gray-600 hover:text-white transition" title="Copiar para outro plano"><Icon.Copy className="w-3.5 h-3.5"/></button>
                                                                <button onClick={() => setActiveFlashcards(set.cards)} disabled={set.cards.length === 0} className="px-3 py-1 bg-cyan-600/20 text-cyan-400 border border-cyan-600/30 rounded text-[9px] font-bold uppercase disabled:opacity-30 hover:bg-cyan-600/40 transition">Revisar ({set.cards.length})</button>
                                                                <button onClick={() => handlePersonalPackAction(goal.id, 'delete', set)} className="text-gray-600 hover:text-red-500 transition"><Icon.Trash className="w-3.5 h-3.5"/></button>
                                                            </div>
                                                        </div>
                                                        {isPackExpanded && (
                                                            <div className="p-4 space-y-4 animate-fade-in border-t border-white/5 bg-black/20">
                                                                <div className="space-y-2">
                                                                    {set.cards.map((card, cidx) => (
                                                                        <div key={card.id} className="bg-[#1A1A1A] border border-white/5 p-3 rounded-lg flex flex-col gap-2 relative group/card">
                                                                            <div className="flex justify-between items-center">
                                                                                <span className="text-[9px] font-bold text-gray-600 uppercase">Card {cidx + 1}</span>
                                                                                <div className="flex gap-1">
                                                                                    <button onClick={() => { const newCards = [...set.cards]; if(cidx > 0) { [newCards[cidx], newCards[cidx-1]] = [newCards[cidx-1], newCards[cidx]]; handlePersonalPackAction(goal.id, 'update', { ...set, cards: newCards }); } }} disabled={cidx === 0} className="text-gray-600 hover:text-white disabled:opacity-10 transition-colors"><Icon.ArrowUp className="w-3 h-3"/></button>
                                                                                    <button onClick={() => { const newCards = [...set.cards]; if(cidx < newCards.length - 1) { [newCards[cidx], newCards[cidx+1]] = [newCards[cidx+1], newCards[cidx]]; handlePersonalPackAction(goal.id, 'update', { ...set, cards: newCards }); } }} disabled={cidx === set.cards.length - 1} className="text-gray-600 hover:text-white disabled:opacity-10 transition-colors"><Icon.ArrowDown className="w-3 h-3"/></button>
                                                                                    <button onClick={() => { const newCards = set.cards.filter(c => c.id !== card.id); handlePersonalPackAction(goal.id, 'update', { ...set, cards: newCards }); }} className="text-gray-700 hover:text-red-500 transition ml-1"><Icon.Trash className="w-3.5 h-3.5"/></button>
                                                                                </div>
                                                                            </div>
                                                                            <input value={card.question} onChange={e => { const newCards = set.cards.map(c => c.id === card.id ? { ...c, question: e.target.value } : c); handlePersonalPackAction(goal.id, 'update', { ...set, cards: newCards }); }} className="bg-black/40 border border-white/5 rounded p-2 text-xs text-white outline-none focus:border-cyan-500/50 transition-colors" placeholder="Pergunta..." />
                                                                            <textarea value={card.answer} onChange={e => { const newCards = set.cards.map(c => c.id === card.id ? { ...c, answer: e.target.value } : c); handlePersonalPackAction(goal.id, 'update', { ...set, cards: newCards }); }} className="bg-black/40 border border-white/5 rounded p-2 text-xs text-gray-300 outline-none focus:border-cyan-500/50 resize-none h-16 transition-colors" placeholder="Resposta..." />
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                                <button onClick={() => { const newCards = [...set.cards, { id: uuid(), question: '', answer: '' }]; handlePersonalPackAction(goal.id, 'update', { ...set, cards: newCards }); }} className="w-full py-2 bg-cyan-600/10 border border-dashed border-cyan-600/30 text-cyan-500 rounded-lg text-[10px] font-bold uppercase hover:bg-cyan-600/20 transition-all">+ Adicionar Pergunta</button>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                            {personalSets.length === 0 && (
                                                <p className="text-[9px] text-gray-600 italic text-center py-4">Nenhum conjunto personalizado criado para este assunto.</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                }

                if (type === 'resumo') {
                    const resources = [];
                    if (goal.pdfUrl) resources.push({ type: 'pdf', url: goal.pdfUrl, label: 'Arquivo PDF' });
                    if (goal.pdfUrls) goal.pdfUrls.forEach(p => resources.push({ type: 'pdf', url: p.url, label: p.name }));
                    if (goal.link) resources.push({ type: 'link', url: goal.link, label: 'Link Principal' });
                    if (goal.links) goal.links.forEach(l => resources.push({ type: 'link', url: l.url, label: l.name })); 
                    
                    return (
                        <div key={type} className={`flex flex-col transition-all duration-200 ${isExpanded ? 'w-full my-2 bg-[#151515] rounded-xl border border-[#333] p-4' : ''}`}>
                             <div className="flex items-center">
                                {canManualComplete && (
                                    <div onClick={(e) => { e.stopPropagation(); toggleGoalComplete(goal.id); }} className={`cursor-pointer w-4 h-4 rounded border flex items-center justify-center mr-2 shrink-0 transition-colors ${isGoalDone ? 'bg-green-500 border-green-500' : 'border-gray-500 hover:border-white'}`} title="Marcar como concluído manualmente">
                                        {isGoalDone && <Icon.Check className="w-3 h-3 text-black"/>}
                                    </div>
                                )}
                                <button onClick={() => toggleEditalSubGoals(goal.id)} className={`flex items-center gap-2 px-2 py-1 rounded border text-[10px] font-bold uppercase transition hover:brightness-125 w-fit ${isGoalDone ? '!border-green-500 !bg-green-500/10 !text-green-500' : ''}`} style={{ borderColor: isGoalDone ? undefined : goal.color || '#333', color: isGoalDone ? undefined : goal.color || '#999' }}>
                                    <IconComp className="w-3 h-3"/> {goal.title} 
                                    {revCount && <span className="text-[8px] bg-cyan-900/40 text-cyan-400 px-1 rounded ml-1 border border-cyan-800">{revCount}</span>}
                                    <span className="opacity-60 font-mono text-[9px] ml-1">({resources.length} itens)</span> <Icon.ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}/>
                                </button>
                            </div>
                            
                            {isExpanded && ( 
                                <div className="mt-4 space-y-6 animate-fade-in pl-1"> 
                                    {resources.length > 0 && (
                                        <div className="space-y-2">
                                             <h4 className="text-[9px] font-black text-gray-500 uppercase tracking-widest border-b border-[#333] pb-1">Materiais de Apoio</h4>
                                             <div className="flex flex-col gap-2">
                                                {resources.map((res, idx) => ( 
                                                    <button key={idx} onClick={() => { 
                                                        if (res.type === 'pdf') openWatermarkedPDF(res.url!, user); 
                                                        else if (res.type === 'link') window.open(res.url, '_blank'); 
                                                    }} className="flex items-center gap-2 px-3 py-2 rounded hover:bg-white/5 text-[10px] font-bold uppercase transition text-gray-300 hover:text-white text-left group/item bg-[#121212] border border-white/5"> 
                                                    <div className="w-5 h-5 rounded-full bg-[#1E1E1E] flex items-center justify-center border border-[#333] shrink-0 group-hover/item:border-insanus-red transition-colors"> 
                                                        {res.type === 'pdf' ? <Icon.FileText className="w-3 h-3 text-insanus-red"/> : res.type === 'link' ? <Icon.Link className="w-2 h-2 text-blue-500"/> : <Icon.Share2 className="w-3 h-3 text-purple-500"/>} 
                                                    </div> <span className="truncate">{res.label}</span> </button> 
                                                ))} 
                                             </div>
                                        </div>
                                    )}
                                    {/* MIND MAPS IN EDITAL */}
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center border-b border-[#333] pb-1">
                                            <h4 className="text-[9px] font-black text-purple-500 uppercase tracking-widest">Mapas Mentais</h4>
                                            <button onClick={() => handlePersonalMindMapAction(goal.id, 'add')} className="text-[8px] font-black text-white hover:text-purple-400 transition uppercase">+ Criar Mapa</button>
                                        </div>
                                        <div className="grid gap-2">
                                            {goal.generatedMindMap && (
                                                <button onClick={() => { setActiveMindMapNode(goal.generatedMindMap!); setActivePersonalMindMap(null); }} className="flex items-center gap-2 px-3 py-2 bg-purple-600/10 border border-purple-600/30 rounded hover:bg-purple-600/20 transition text-[10px] font-bold uppercase text-purple-400">
                                                    <Icon.Share2 className="w-3 h-3"/> Mapa Mental (IA)
                                                </button>
                                            )}
                                            {user.personalMindMaps?.[goal.id]?.map(map => (
                                                <div key={map.id} className="flex items-center justify-between bg-black/40 border border-white/5 rounded px-3 py-2 hover:border-purple-500/30 transition group">
                                                    {editingMindMapNameId === map.id ? (
                                                        <input 
                                                            autoFocus
                                                            defaultValue={map.name}
                                                            onBlur={(e) => {
                                                                handlePersonalMindMapAction(goal.id, 'update', { ...map, name: e.target.value });
                                                                setEditingMindMapNameId(null);
                                                            }}
                                                            onKeyDown={(e) => {
                                                                if(e.key === 'Enter') {
                                                                    handlePersonalMindMapAction(goal.id, 'update', { ...map, name: e.currentTarget.value });
                                                                    setEditingMindMapNameId(null);
                                                                }
                                                            }}
                                                            className="bg-transparent text-[10px] font-bold uppercase text-white outline-none w-full border-b border-purple-500"
                                                        />
                                                    ) : (
                                                        <button onClick={() => { setActiveMindMapNode(map.root); setActivePersonalMindMap(map); }} className="flex items-center gap-2 text-[10px] font-bold uppercase text-gray-300 hover:text-white transition flex-1 text-left">
                                                            <Icon.Share2 className="w-3 h-3 text-purple-600"/> {map.name}
                                                        </button>
                                                    )}
                                                    
                                                    <div className="flex items-center gap-2 transition">
                                                        {editingMindMapNameId !== map.id && (
                                                            <button onClick={() => setEditingMindMapNameId(map.id)} className="text-gray-600 hover:text-white" title="Renomear"><Icon.Edit className="w-3 h-3"/></button>
                                                        )}
                                                        <button onClick={() => setMigrationData({ type: 'mindmap', item: map })} className="text-gray-600 hover:text-white" title="Copiar"><Icon.Copy className="w-3 h-3"/></button>
                                                        <button onClick={() => handlePersonalMindMapAction(goal.id, 'delete', map)} className="text-gray-600 hover:text-red-500"><Icon.Trash className="w-3 h-3"/></button>
                                                    </div>
                                                </div>
                                            ))}
                                            {!goal.generatedMindMap && (!user.personalMindMaps?.[goal.id] || user.personalMindMaps[goal.id].length === 0) && (
                                                <p className="text-[9px] text-gray-600 italic text-center py-2">Nenhum mapa mental disponível.</p>
                                            )}
                                        </div>
                                    </div>
                                </div> 
                            )}
                        </div>
                    );
                }

                if (type === 'aula' && goal.subGoals && goal.subGoals.length > 0) {
                     return (
                        <div key={type} className={`flex flex-col transition-all duration-200 ${isExpanded ? 'w-full my-2 bg-[#151515] rounded-lg border border-[#333] p-2' : ''}`}>
                            <div className="flex items-center">
                                {canManualComplete && (
                                    <div onClick={(e) => { e.stopPropagation(); toggleGoalComplete(goal.id); }} className={`cursor-pointer w-4 h-4 rounded border flex items-center justify-center mr-2 shrink-0 transition-colors ${isGoalDone ? 'bg-green-500 border-green-500' : 'border-gray-500 hover:border-white'}`} title="Marcar como concluído manualmente">
                                        {isGoalDone && <Icon.Check className="w-3 h-3 text-black"/>}
                                    </div>
                                )}
                                <button onClick={() => toggleEditalSubGoals(goal.id)} className={`flex items-center gap-2 px-2 py-1 rounded border text-[10px] font-bold uppercase transition hover:brightness-125 w-fit ${isGoalDone ? '!border-green-500 !bg-green-500/10 !text-green-500' : ''}`} style={{ borderColor: isGoalDone ? undefined : goal.color || '#333', color: isGoalDone ? undefined : goal.color || '#999' }}>
                                    <IconComp className="w-3 h-3"/> {goal.title} 
                                    {revCount && <span className="text-[8px] bg-cyan-900/40 text-cyan-400 px-1 rounded ml-1 border border-cyan-800">{revCount}</span>}
                                    <span className="opacity-60 font-mono text-[9px] ml-1">({goal.subGoals.length} aulas)</span> <Icon.ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}/>
                                </button>
                            </div>
                            {isExpanded && ( <div className="flex flex-col gap-1 mt-2 pl-2 border-l border-[#333] ml-1 animate-fade-in"> 
                                {goal.subGoals.map((sub, idx) => {
                                    const isSubDone = (user.progress.completedGoalIds as string[]).includes(`${goal.id}:${sub.id}`);
                                    return ( 
                                        <div key={sub.id || idx} className="flex items-center gap-2 group/link">
                                            {canManualComplete && (
                                                <div onClick={(e) => { e.stopPropagation(); handleManualSubGoalToggle(goal.id, sub.id); }} className={`cursor-pointer w-3 h-3 rounded border flex items-center justify-center shrink-0 transition-colors ${isSubDone ? 'bg-green-600 border-green-600' : 'border-gray-600 hover:border-white'}`} title="Marcar aula como concluída">
                                                    {isSubDone && <Icon.Check className="w-2 h-2 text-black"/>}
                                                </div>
                                            )}
                                            <a href={sub.link || '#'} target="_blank" rel="noreferrer" onClick={(e) => { if(!sub.link) e.preventDefault(); }} className={`flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 text-[10px] font-bold uppercase transition w-full ${isGoalDone || isSubDone ? 'text-green-500/70 hover:text-green-400' : 'text-gray-400 hover:text-white'}`}> 
                                                <div className={`w-4 h-4 rounded-full bg-[#1E1E1E] flex items-center justify-center border border-[#333] transition ${isGoalDone || isSubDone ? 'border-green-500/50 text-green-500' : 'group-hover/link:border-insanus-red group-hover/link:text-insanus-red'}`}><Icon.Play className="w-2 h-2"/></div> 
                                                <span className="truncate">{sub.title}</span> {sub.duration && <span className="text-[8px] bg-black px-1 rounded text-gray-600 ml-auto font-mono">{sub.duration}m</span>} 
                                            </a> 
                                        </div>
                                    );
                                })} 
                            </div> )}
                        </div>
                    );
                }

                const resources = [];
                if (goal.pdfUrl) resources.push({ type: 'pdf', url: goal.pdfUrl, label: 'Arquivo PDF' });
                if (goal.pdfUrls) goal.pdfUrls.forEach(p => resources.push({ type: 'pdf', url: p.url, label: p.name }));
                if (goal.link) resources.push({ type: 'link', url: goal.link, label: 'Link Principal' });
                if (goal.links) goal.links.forEach(l => resources.push({ type: 'link', url: l.url, label: l.name })); 
                
                if (resources.length > 1) {
                     return (
                        <div key={type} className={`flex flex-col transition-all duration-200 ${isExpanded ? 'w-full my-2 bg-[#151515] rounded-lg border border-[#333] p-2' : ''}`}>
                             <div className="flex items-center">
                                {canManualComplete && (
                                    <div onClick={(e) => { e.stopPropagation(); toggleGoalComplete(goal.id); }} className={`cursor-pointer w-4 h-4 rounded border flex items-center justify-center mr-2 shrink-0 transition-colors ${isGoalDone ? 'bg-green-500 border-green-500' : 'border-gray-500 hover:border-white'}`} title="Marcar como concluído manualmente">
                                        {isGoalDone && <Icon.Check className="w-3 h-3 text-black"/>}
                                    </div>
                                )}
                                <button onClick={() => toggleEditalSubGoals(goal.id)} className={`flex items-center gap-2 px-2 py-1 rounded border text-[10px] font-bold uppercase transition hover:brightness-125 w-fit ${isGoalDone ? '!border-green-500 !bg-green-500/10 !text-green-500' : ''}`} style={{ borderColor: isGoalDone ? undefined : goal.color || '#333', color: isGoalDone ? undefined : goal.color || '#999' }}>
                                    <IconComp className="w-3 h-3"/> {goal.title} 
                                    {revCount && <span className="text-[8px] bg-cyan-900/40 text-cyan-400 px-1 rounded ml-1 border border-cyan-800">{revCount}</span>}
                                    <span className="opacity-60 font-mono text-[9px] ml-1">({resources.length} itens)</span> <Icon.ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}/>
                                </button>
                            </div>
                            {isExpanded && ( <div className="flex flex-col gap-1 mt-2 pl-2 border-l border-[#333] ml-1 animate-fade-in"> 
                                {resources.map((res, idx) => ( 
                                    <button key={idx} onClick={() => { 
                                        if (res.type === 'pdf') openWatermarkedPDF(res.url!, user); 
                                        else if (res.type === 'link') window.open(res.url, '_blank'); 
                                    }} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 text-[10px] font-bold uppercase transition text-gray-300 hover:text-white text-left group/item"> 
                                    <div className="w-4 h-4 rounded-full bg-[#1E1E1E] flex items-center justify-center border border-[#333] shrink-0 group-hover/item:border-insanus-red transition-colors"> 
                                        {res.type === 'pdf' ? <Icon.FileText className="w-2 h-2 text-insanus-red"/> : res.type === 'link' ? <Icon.Link className="w-2 h-2 text-blue-500"/> : <Icon.Share2 className="w-2 h-2 text-purple-500"/>} 
                                    </div> <span className="truncate">{res.label}</span> </button> ))} </div> )}
                        </div>
                    );
                }
                if (resources.length === 1) {
                    const res = resources[0];
                    return ( 
                        <div key={type} className="flex items-center">
                            {canManualComplete && (
                                <div onClick={(e) => { e.stopPropagation(); toggleGoalComplete(goal.id); }} className={`cursor-pointer w-4 h-4 rounded border flex items-center justify-center mr-2 shrink-0 transition-colors ${isGoalDone ? 'bg-green-500 border-green-500' : 'border-gray-500 hover:border-white'}`} title="Marcar como concluído manualmente">
                                    {isGoalDone && <Icon.Check className="w-3 h-3 text-black"/>}
                                </div>
                            )}
                            <button onClick={() => { 
                                if (res.type === 'pdf') openWatermarkedPDF(res.url!, user); 
                                else if (res.type === 'link') window.open(res.url, '_blank'); 
                            }} className={`flex items-center gap-2 px-2 py-1 rounded border text-[10px] font-bold uppercase transition hover:brightness-125 ${isGoalDone ? '!border-green-500 !bg-green-500/10 !text-green-500' : ''}`} style={{ borderColor: isGoalDone ? undefined : goal.color || '#333', color: isGoalDone ? undefined : goal.color || '#999' }}> <IconComp className="w-3 h-3"/> {goal.title} {revCount && <span className="text-[8px] bg-cyan-900/40 text-cyan-400 px-1 rounded ml-1 border border-cyan-800">{revCount}</span>} </button> 
                        </div>
                    );
                }
                return ( 
                    <div key={type} className="flex items-center">
                        {canManualComplete && (
                            <div onClick={(e) => { e.stopPropagation(); toggleGoalComplete(goal.id); }} className={`cursor-pointer w-4 h-4 rounded border flex items-center justify-center mr-2 shrink-0 transition-colors ${isGoalDone ? 'bg-green-500 border-green-500' : 'border-gray-500 hover:border-white'}`} title="Marcar como concluído manualmente">
                                {isGoalDone && <Icon.Check className="w-3 h-3 text-black"/>}
                            </div>
                        )}
                        <button disabled className={`flex items-center gap-2 px-2 py-1 rounded border text-[10px] font-bold uppercase opacity-50 cursor-not-allowed`} style={{ borderColor: goal.color || '#333', color: goal.color || '#999' }}> <IconComp className="w-3 h-3"/> {goal.title} {revCount && <span className="text-[8px] bg-cyan-900/40 text-cyan-400 px-1 rounded ml-1 border border-cyan-800">{revCount}</span>} </button> 
                    </div>
                );
            })}
        </div>
    );

    return (
        <div className="w-full animate-fade-in space-y-6">
            <div className="flex justify-between items-end border-b border-[#333] pb-4">
                <div> <h2 className="text-3xl font-black text-white uppercase tracking-tight">Edital Verticalizado</h2> <p className="text-gray-500 text-sm">Acompanhe sua cobertura do edital.</p> </div>
                <div className="text-right"> <div className="text-3xl font-black text-insanus-red">{percentage}%</div> <div className="text-[10px] text-gray-500 uppercase font-bold">Cobertura</div> </div>
            </div>
            <div className="space-y-4">
                {currentPlan.editalVerticalizado.map(disc => {
                    const isExp = editalExpanded.includes(disc.id);
                    let dTotal = 0; let dDone = 0;
                    disc.topics.forEach(t => { dTotal++; if (isTopicDone(t)) dDone++; if (t.subTopics) { t.subTopics.forEach(st => { dTotal++; if (isSubTopicDone(st)) dDone++; }); } });
                    const dProg = dTotal > 0 ? Math.round((dDone / dTotal) * 100) : 0;
                    return (
                        <div key={disc.id} className="bg-[#121212] rounded-xl border border-[#333] overflow-hidden">
                            <div onClick={() => toggleEditalDisc(disc.id)} className="p-4 flex items-center justify-between cursor-pointer hover:bg-[#1E1E1E] transition border-b border-[#333]">
                                <div className="flex items-center gap-3"> <Icon.ChevronDown className={`w-5 h-5 text-gray-500 transition-transform ${isExp ? 'rotate-180' : ''}`} /> <h3 className="font-bold text-white uppercase">{disc.name}</h3> </div>
                                <div className="flex items-center gap-4"> <div className="w-32 h-2 bg-black rounded-full overflow-hidden border border-[#333]"> <div className="h-full bg-insanus-red" style={{ width: `${dProg}%` }}></div> </div> <span className="text-xs font-mono text-gray-400 w-10 text-right">{dProg}%</span> </div>
                            </div>
                            {isExp && (
                                <div className="p-4 space-y-2 animate-fade-in bg-[#0F0F0F]">
                                    {disc.topics.map(topic => {
                                        const linkedGoalIds = ORDERED_LINKS.map(type => topic.links[type as keyof typeof topic.links]).filter(id => !!id) as string[];
                                        const topicLinksDone = linkedGoalIds.length > 0 && linkedGoalIds.every(gid => isLinkDone(gid));
                                        return (
                                            <div key={topic.id} className="flex flex-col gap-2 py-2 border-b border-[#333] last:border-0">
                                                <div className="flex items-center gap-3 text-sm group">
                                                    <div 
                                                        onClick={canManualComplete ? (e) => { e.stopPropagation(); toggleTopicComplete(topic); } : undefined}
                                                        className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${topicLinksDone ? 'bg-green-600 border-green-600' : 'border-gray-600'} ${canManualComplete ? 'cursor-pointer hover:border-white' : ''}`}
                                                    > 
                                                        {topicLinksDone && <Icon.Check className="w-3 h-3 text-black" />} 
                                                    </div>
                                                    <span className={`font-bold ${topicLinksDone ? 'text-gray-500 line-through' : 'text-gray-200'}`}>{topic.name}</span>
                                                </div>
                                                {renderLinksRow(topic.links)}
                                                {topic.subTopics && topic.subTopics.length > 0 && (
                                                    <div className="ml-7 mt-2 pl-4 border-l border-[#333] space-y-2">
                                                        {topic.subTopics.map(sub => {
                                                            const subDone = isSubTopicDone(sub);
                                                            return (
                                                                <div key={sub.id} className="flex flex-col gap-1">
                                                                    <div className="flex items-center gap-2 text-xs">
                                                                        <div 
                                                                            onClick={canManualComplete ? (e) => { e.stopPropagation(); toggleSubTopicComplete(sub); } : undefined}
                                                                            className={`w-3 h-3 rounded border flex items-center justify-center shrink-0 ${subDone ? 'bg-green-600 border-green-600' : 'border-gray-600'} ${canManualComplete ? 'cursor-pointer hover:border-white' : ''}`}
                                                                        > 
                                                                            {subDone && <Icon.Check className="w-2 h-2 text-black" />} 
                                                                        </div>
                                                                        <span className={`${subDone ? 'text-gray-500 line-through' : 'text-gray-400'}`}>{sub.name}</span>
                                                                    </div>
                                                                    {renderLinksRow(sub.links)}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    );
  };

  const currentDaysRemaining = currentPlan ? getDaysRemaining(user.planExpirations?.[currentPlan.id]) : 365;

  // HELPERS FOR SIMULADOS FILTERS
  const getSimCats = (list: SimuladoClass[]) => Array.from(new Set(list.map(s => s.category))).filter(Boolean).sort();
  const getSimSubs = (list: SimuladoClass[], cat: string) => Array.from(new Set(list.filter(s => s.category === cat).map(s => s.subCategory))).filter(Boolean).sort();

  // FILTERED LISTS
  const unlockedClasses = simuladoClasses.filter(sc => user.isAdmin || user.allowedSimuladoClasses?.includes(sc.id) || (currentPlan?.linkedSimuladoClasses?.includes(sc.id)));
  const lockedClasses = simuladoClasses.filter(sc => !(user.isAdmin || user.allowedSimuladoClasses?.includes(sc.id) || (currentPlan?.linkedSimuladoClasses?.includes(sc.id))));

  const filteredUnlockedSimulados = unlockedClasses.filter(sc => 
      (!availSimCat || sc.category === availSimCat) &&
      (!availSimSub || sc.subCategory === availSimSub) &&
      (!availSimOrg || sc.organization?.toUpperCase().includes(availSimOrg.toUpperCase()))
  );

  const filteredLockedSimulados = lockedClasses.filter(sc => 
      (!lockedSimCat || sc.category === lockedSimCat) &&
      (!lockedSimSub || sc.subCategory === lockedSimSub) &&
      (!lockedSimOrg || sc.organization?.toUpperCase().includes(lockedSimOrg.toUpperCase()))
  );

  return (
    <div className="flex flex-col h-full w-full bg-[#050505] text-gray-200">
        {activeFlashcards && <FlashcardViewer flashcards={activeFlashcards} onClose={() => setActiveFlashcards(null)} />}
        
        {/* MIND MAP VIEWER / EDITOR */}
        {activeMindMapNode && (
            <VisualMindMapModal 
                rootNode={activeMindMapNode} 
                onSave={(node) => {
                    // Se estiver editando um mapa pessoal, salva as alterações
                    if (activePersonalMindMap && activeMindMapNode) {
                        let targetGoalId = '';
                        if (user.personalMindMaps) {
                            // Encontra o ID da meta (goalId) varrendo as chaves
                            const foundKey = Object.keys(user.personalMindMaps).find(key => 
                                user.personalMindMaps![key].some(m => m.id === activePersonalMindMap.id)
                            );
                            if (foundKey) targetGoalId = foundKey;
                        }
                        
                        if (targetGoalId) {
                            handlePersonalMindMapAction(targetGoalId, 'update', { ...activePersonalMindMap, root: node });
                        }
                    }
                    // Se for mapa do Admin (IA), onSave não faz nada (apenas fecha visualmente ou descarta alterações locais, pois aluno não edita o plano original)
                    setActiveMindMapNode(null); 
                    setActivePersonalMindMap(null);
                }}
                onClose={() => { setActiveMindMapNode(null); setActivePersonalMindMap(null); }}
                title={activePersonalMindMap ? activePersonalMindMap.name : "Visualizador de Mapa Mental"}
            />
        )}
        
        {/* NOTEBOOK MODAL */}
        {activeNotebookGoalId && (
            <NotebookModal
                goalId={activeNotebookGoalId.id}
                goalTitle={activeNotebookGoalId.title}
                notes={user.personalNotes?.[activeNotebookGoalId.id] || []}
                onSave={handleSaveNote}
                onDelete={handleDeleteNote}
                onClose={() => setActiveNotebookGoalId(null)}
            />
        )}

        {/* MIGRATION MODAL */}
        {migrationData && (
            <MigrationModal
                user={user}
                plans={plans}
                sourceItem={migrationData.item}
                sourceType={migrationData.type}
                onClose={() => setMigrationData(null)}
                onConfirm={executeMigration}
            />
        )}
        
        {confirmModal && confirmModal.isOpen && ( <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"> <div className="bg-[#121212] border border-[#333] p-6 rounded-xl w-full max-sm shadow-neon"> <h3 className="text-lg font-bold text-white mb-2">{confirmModal.title}</h3> <p className="text-gray-400 text-sm mb-6">{confirmModal.message}</p> <div className="flex gap-3"> <button onClick={() => setConfirmModal(null)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2 rounded-lg text-xs font-bold transition">CANCELAR</button> <button onClick={confirmModal.onConfirm} className="flex-1 bg-insanus-red hover:bg-red-600 text-white py-2 rounded-lg text-xs font-bold transition shadow-lg">CONFIRMAR</button> </div> </div> </div> )}
        <div className="h-14 border-b border-[#333] bg-[#0F0F0F] flex items-center px-8 gap-8 shrink-0 overflow-x-auto custom-scrollbar z-20 shadow-sm">
             <div className="flex gap-6 flex-1">
                 <button onClick={() => setView('daily')} className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider py-4 border-b-2 transition-all ${view === 'daily' ? 'text-white border-insanus-red' : 'text-gray-500 border-transparent hover:text-gray-300'}`}><Icon.Check className="w-4 h-4"/> Metas de Hoje</button>
                 <button onClick={() => setView('calendar')} className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider py-4 border-b-2 transition-all ${view === 'calendar' ? 'text-white border-insanus-red' : 'text-gray-500 border-transparent hover:text-gray-300'}`}><Icon.Calendar className="w-4 h-4"/> Calendário</button>
                 <button onClick={() => setView('edital')} className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider py-4 border-b-2 transition-all ${view === 'edital' ? 'text-white border-insanus-red' : 'text-gray-500 border-transparent hover:text-gray-300'}`}><Icon.List className="w-4 h-4"/> Edital</button>
                 <button onClick={() => setView('simulados')} className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider py-4 border-b-2 transition-all ${view === 'simulados' ? 'text-white border-insanus-red' : 'text-gray-500 border-transparent hover:text-gray-300'}`}><Icon.FileText className="w-4 h-4"/> Simulados</button>
                 <button onClick={() => setView('setup')} className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider py-4 border-b-2 transition-all ${view === 'setup' ? 'text-white border-insanus-red' : 'text-gray-500 border-transparent hover:text-gray-300'}`}><Icon.Clock className="w-4 h-4"/> Configuração</button>
             </div>
             <div className="flex items-center gap-4">
                 {/* NEW: Plan Study Time Display */}
                 {currentPlan && (
                    <div className="text-right hidden md:block border-r border-[#333] pr-4 mr-2"> 
                        <div className="text-[9px] text-gray-500 font-bold uppercase">Tempo no Plano</div> 
                        <div className="text-xs font-black text-white font-mono">{formatSecondsToTime(user.progress.planStudySeconds?.[currentPlan.id] || 0)}</div> 
                    </div>
                 )}
                 <div className="text-right hidden md:block"> <div className="text-[9px] text-gray-500 font-bold uppercase">Tempo Total</div> <div className="text-xs font-black text-insanus-red font-mono">{formatSecondsToTime(user.progress.totalStudySeconds)}</div> </div>
                 {(onReturnToAdmin || user.isAdmin) && <button onClick={onReturnToAdmin} className="text-gray-500 hover:text-white p-2 rounded-full hover:bg-white/5 transition" title="Voltar para Admin"><Icon.LogOut className="w-4 h-4"/></button>}
             </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar relative bg-[#050505]">
            {activeSimulado ? ( <SimuladoRunner user={user} classId="" simulado={activeSimulado} attempt={attempts.find(a => a.simuladoId === activeSimulado.id)} allAttempts={allAttempts} allUsersMap={allUsersMap} onFinish={handleSimuladoFinished} onBack={() => setActiveSimulado(null)} /> ) : (
                <> 
                   {view === 'setup' && <SetupWizard user={user} allPlans={plans} currentPlan={currentPlan} onSave={handleSetupSave} onPlanAction={handlePlanAction} onUpdateUser={onUpdateUser} onSelectPlan={initiatePlanSwitch} />} 
                   {view !== 'setup' && currentDaysRemaining <= 0 ? (
                       <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
                           <div className="w-20 h-20 rounded-full bg-red-900/20 flex items-center justify-center border border-red-500/50">
                               <Icon.Clock className="w-10 h-10 text-red-500"/>
                           </div>
                           <h2 className="text-3xl font-black text-white uppercase">Acesso Expirado</h2>
                           <p className="text-gray-400 max-w-md">O seu tempo de acesso a este plano encerrou. Renove sua assinatura ou selecione outro plano disponível.</p>
                           <button onClick={() => setView('setup')} className="bg-insanus-red hover:bg-red-600 text-white px-6 py-3 rounded-xl font-bold uppercase shadow-neon transition mt-4">GERENCIAR PLANOS</button>
                       </div>
                   ) : (
                       <>
                           {view === 'daily' && renderDailyView()} 
                           {view === 'calendar' && renderCalendarView()} 
                           {view === 'edital' && renderEditalView()} 
                           {view === 'simulados' && (
                                <div className="w-full animate-fade-in space-y-10">
                                    {!activeSimuladoClass ? (
                                        <>
                                            {/* SEÇÃO 1: LIBERADOS */}
                                            <div className="bg-[#121212] p-8 rounded-2xl border border-[#333]">
                                                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 border-b border-[#333] pb-4 gap-4">
                                                    <h3 className="text-xl font-bold text-white flex items-center gap-2"><Icon.Check className="w-5 h-5 text-green-500"/> MEUS SIMULADOS (LIBERADOS)</h3>
                                                    <div className="flex gap-2">
                                                        <select value={availSimCat} onChange={e => { setAvailSimCat(e.target.value); setAvailSimSub(''); }} className="bg-black/40 border border-[#333] rounded px-3 py-2 text-xs text-white outline-none focus:border-green-500 uppercase">
                                                            <option value="">Todas Categorias</option>
                                                            {getSimCats(unlockedClasses).map(c => <option key={c} value={c}>{c}</option>)}
                                                        </select>
                                                        <select value={availSimSub} onChange={e => setAvailSimSub(e.target.value)} className="bg-black/40 border border-[#333] rounded px-3 py-2 text-xs text-white outline-none focus:border-green-500 uppercase disabled:opacity-50" disabled={!availSimCat}>
                                                            <option value="">Todas Subcategorias</option>
                                                            {getSimSubs(unlockedClasses, availSimCat).map(s => <option key={s} value={s}>{s}</option>)}
                                                        </select>
                                                        <input 
                                                            type="text" 
                                                            placeholder="FILTRAR POR ÓRGÃO..." 
                                                            value={availSimOrg}
                                                            onChange={(e) => setAvailSimOrg(e.target.value)}
                                                            className="bg-black/40 border border-[#333] rounded px-3 py-2 text-xs text-white outline-none focus:border-green-500 uppercase w-40"
                                                        />
                                                    </div>
                                                </div>
                                                {filteredUnlockedSimulados.length === 0 ? (
                                                    <div className="text-gray-500 italic text-sm">Nenhuma turma liberada encontrada com estes filtros.</div>
                                                ) : (
                                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                                        {filteredUnlockedSimulados.map(sc => (
                                                            <div key={sc.id} className="group relative bg-[#121212] border border-[#333] hover:border-white/20 rounded-2xl overflow-hidden flex flex-col transition-all duration-300">
                                                                <div className="aspect-square w-full bg-gray-900 relative overflow-hidden">
                                                                    {sc.coverImage ? ( <img src={sc.coverImage} alt={sc.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" /> ) : ( <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#1A1A1A] to-[#0A0A0A]"> <Icon.List className="w-16 h-16 text-[#333]"/> </div> )}
                                                                    <div className="absolute top-3 right-3">
                                                                        <span className="bg-green-600 text-white text-[9px] font-black px-2 py-1 rounded uppercase tracking-wider shadow-lg flex items-center gap-1">
                                                                            <Icon.Check className="w-3 h-3"/> LIBERADO
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                                <div className="p-5 flex-1 flex flex-col">
                                                                    <h3 className="text-lg font-black uppercase leading-tight mb-1 text-white">{sc.name}</h3>
                                                                    <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-6">{sc.simulados.length} Simulados</p>
                                                                    <div className="mt-auto">
                                                                        <button onClick={() => setActiveSimuladoClass(sc)} className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/30 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2">
                                                                            ACESSAR TURMA
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            {/* SEÇÃO 2: BLOQUEADOS (LOJA) */}
                                            <div className="bg-[#121212] p-8 rounded-2xl border border-[#333]">
                                                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 border-b border-[#333] pb-4 gap-4">
                                                    <h3 className="text-xl font-bold text-white flex items-center gap-2"><Icon.List className="w-5 h-5 text-gray-500"/> LOJA DE SIMULADOS (BLOQUEADOS)</h3>
                                                    <div className="flex gap-2">
                                                        <select value={lockedSimCat} onChange={e => { setLockedSimCat(e.target.value); setLockedSimSub(''); }} className="bg-black/40 border border-[#333] rounded px-3 py-2 text-xs text-gray-300 outline-none focus:border-white uppercase">
                                                            <option value="">Todas Categorias</option>
                                                            {getSimCats(lockedClasses).map(c => <option key={c} value={c}>{c}</option>)}
                                                        </select>
                                                        <select value={lockedSimSub} onChange={e => setLockedSimSub(e.target.value)} className="bg-black/40 border border-[#333] rounded px-3 py-2 text-xs text-gray-300 outline-none focus:border-white uppercase disabled:opacity-50" disabled={!lockedSimCat}>
                                                            <option value="">Todas Subcategorias</option>
                                                            {getSimSubs(lockedClasses, lockedSimCat).map(s => <option key={s} value={s}>{s}</option>)}
                                                        </select>
                                                        <input 
                                                            type="text" 
                                                            placeholder="FILTRAR POR ÓRGÃO..." 
                                                            value={lockedSimOrg}
                                                            onChange={(e) => setLockedSimOrg(e.target.value)}
                                                            className="bg-black/40 border border-[#333] rounded px-3 py-2 text-xs text-gray-300 outline-none focus:border-white uppercase w-40"
                                                        />
                                                    </div>
                                                </div>
                                                {filteredLockedSimulados.length === 0 ? (
                                                    <div className="text-gray-500 italic text-sm">Nenhuma turma extra disponível.</div>
                                                ) : (
                                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                                        {filteredLockedSimulados.map(sc => (
                                                            <div key={sc.id} className="group relative bg-[#121212] border border-[#333] rounded-2xl overflow-hidden flex flex-col grayscale opacity-80 hover:grayscale-0 hover:opacity-100 transition-all duration-300 hover:border-gray-500">
                                                                <div className="aspect-square w-full bg-gray-900 relative overflow-hidden">
                                                                    {sc.coverImage ? ( <img src={sc.coverImage} alt={sc.name} className="w-full h-full object-cover opacity-60 transition-opacity" /> ) : ( <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#1A1A1A] to-[#0A0A0A]"> <Icon.List className="w-16 h-16 text-[#333]"/> </div> )}
                                                                    <div className="absolute top-3 right-3">
                                                                        <span className="bg-black/90 text-gray-400 border border-white/10 text-[9px] font-black px-2 py-1 rounded uppercase tracking-wider shadow-lg flex items-center gap-1">
                                                                            <Icon.EyeOff className="w-3 h-3"/> BLOQUEADO
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                                <div className="p-5 flex-1 flex flex-col">
                                                                    <h3 className="text-lg font-black uppercase leading-tight mb-1 text-gray-300">{sc.name}</h3>
                                                                    <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-6">{sc.simulados.length} Simulados</p>
                                                                    <div className="mt-auto">
                                                                        {sc.purchaseLink ? (
                                                                            <div className="space-y-2">
                                                                                <a 
                                                                                    href={sc.purchaseLink} 
                                                                                    target="_blank" 
                                                                                    rel="noreferrer"
                                                                                    className="w-full py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-neon flex items-center justify-center gap-2 transform hover:scale-[1.02]"
                                                                                >
                                                                                    <Icon.Check className="w-4 h-4"/> COMPRAR ACESSO
                                                                                </a>
                                                                                <p className="text-[8px] text-gray-500 text-center leading-tight">
                                                                                    O acesso será liberado em dias úteis no prazo de 24 horas após a compra.
                                                                                </p>
                                                                            </div>
                                                                        ) : (
                                                                            <button disabled className="w-full py-3 bg-[#1A1A1A] border border-[#333] text-gray-600 rounded-xl text-xs font-black uppercase tracking-widest cursor-not-allowed flex items-center justify-center gap-2">
                                                                                INDISPONÍVEL
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    ) : (
                                        <div className="animate-slide-up">
                                            <div className="flex items-center gap-4 mb-8 border-b border-[#333] pb-4">
                                                <button onClick={() => setActiveSimuladoClass(null)} className="text-gray-500 hover:text-white transition p-2 rounded-full hover:bg-white/5">
                                                    <Icon.ArrowUp className="w-6 h-6 -rotate-90"/>
                                                </button>
                                                <div>
                                                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">TURMA SELECIONADA</span>
                                                    <h2 className="text-3xl font-black text-white uppercase tracking-tighter leading-none">{activeSimuladoClass.name}</h2>
                                                </div>
                                            </div>
                                            
                                            {activeSimuladoClass.simulados.length === 0 ? (
                                                <div className="text-center py-20 border border-dashed border-[#333] rounded-2xl">
                                                    <p className="text-gray-500 italic">Nenhum simulado cadastrado nesta turma ainda.</p>
                                                </div>
                                            ) : (
                                                <div className="grid gap-4">
                                                    {activeSimuladoClass.simulados.map((sim, idx) => {
                                                        const attempt = attempts.find(a => a.simuladoId === sim.id);
                                                        return (
                                                            <div key={sim.id} className="bg-[#121212] p-5 rounded-xl border border-[#333] hover:border-white/10 transition-all group flex items-center justify-between">
                                                                <div className="flex items-center gap-4">
                                                                    <div className="w-10 h-10 rounded-lg bg-[#1A1A1A] flex items-center justify-center text-gray-500 font-mono text-sm font-bold border border-[#333]">
                                                                        {idx + 1}
                                                                    </div>
                                                                    <div>
                                                                        <h4 className="font-bold text-white text-lg">{sim.title}</h4>
                                                                        <div className="flex items-center gap-2 mt-1">
                                                                            <span className="text-[10px] font-bold bg-white/5 px-2 py-0.5 rounded text-gray-400 uppercase">{sim.totalQuestions} Questões</span>
                                                                            {attempt && (
                                                                                <span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase ${attempt.isApproved ? 'bg-green-900/20 text-green-500' : 'bg-red-900/20 text-red-500'}`}>
                                                                                    {attempt.isApproved ? 'APROVADO' : 'REPROVADO'} ({attempt.score} pts)
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <button 
                                                                    onClick={() => setActiveSimulado(sim)} 
                                                                    className={`px-6 py-3 rounded-lg text-xs font-black uppercase transition shadow-lg flex items-center gap-2 ${attempt ? 'bg-[#1A1A1A] hover:bg-[#222] text-white border border-[#333]' : 'bg-insanus-red hover:bg-red-600 text-white shadow-neon'}`}
                                                                >
                                                                    {attempt ? <><Icon.Eye className="w-4 h-4"/> VER RESULTADO</> : <><Icon.Play className="w-4 h-4"/> INICIAR PROVA</>}
                                                                </button>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                           )} 
                       </>
                   )}
                </>
            )}
        </div>
    </div>
  );
};
