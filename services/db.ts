
import { db, firebaseConfig } from '../firebase';
import { collection, doc, setDoc, getDocs, getDoc, query, where, deleteDoc, writeBatch } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { User, StudyPlan, SimuladoClass, SimuladoAttempt, CategoryDefinition, DatabaseBackup, CloudBackup } from '../types';
import { uploadJSONBackup } from './storage';
import { ADMIN_EMAIL } from '../constants';

// Helper to remove undefined fields because Firestore doesn't support them.
const cleanData = (obj: any): any => {
    return JSON.parse(JSON.stringify(obj));
};

// --- AUTHENTICATION MANAGEMENT (STUDENTS) ---

export const createAuthUser = async (email: string, password: string): Promise<string> => {
    // Inicializa uma instância SECUNDÁRIA para não deslogar o Admin atual
    const secondaryApp = initializeApp(firebaseConfig, "SecondaryAppStudentCreation");
    const secondaryAuth = getAuth(secondaryApp);

    try {
        const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        const uid = userCredential.user.uid;
        
        // Logout e limpeza da instância secundária
        await signOut(secondaryAuth);
        await deleteApp(secondaryApp);
        
        return uid;
    } catch (error: any) {
        await deleteApp(secondaryApp); // Garante limpeza em caso de erro
        throw error;
    }
};

// --- COLLABORATOR MANAGEMENT (NEW) ---

export const createCollaborator = async (name: string, username: string, password: string, permissions: string[]) => {
    // 1. Define o e-mail interno mascarado
    const email = `${username}@staff.insanus`;

    // 2. Inicializa uma instância SECUNDÁRIA do Firebase App
    // Isso é crucial para criar um usuário sem deslogar o admin atual (auth principal)
    const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp");
    const secondaryAuth = getAuth(secondaryApp);

    try {
        // 3. Cria o usuário na Auth Secundária
        const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        const uid = userCredential.user.uid;

        // 4. Salva os dados no Firestore (usando a instância principal 'db')
        const newCollaborator: User = {
            id: uid,
            name: name,
            email: email,
            cpf: 'STAFF', // Placeholder
            level: 'avancado', // Irrelevante para staff
            isAdmin: true, // Flag base true para acessar painel admin
            permissions: permissions, // RBAC define o que ele vê
            allowedPlans: [],
            allowedSimuladoClasses: [],
            planExpirations: {},
            simuladoExpirations: {},
            planConfigs: {},
            routine: { days: {} },
            progress: { completedGoalIds: [], completedRevisionIds: [], totalStudySeconds: 0, planStudySeconds: {} },
            createdAt: new Date().toISOString()
        };

        await setDoc(doc(db, "users", uid), cleanData(newCollaborator));
        
        // 5. Limpeza: Desloga da instância secundária e deleta o app temporário
        await signOut(secondaryAuth);
        await deleteApp(secondaryApp);

        return true;
    } catch (error: any) {
        // Limpeza em caso de erro
        await deleteApp(secondaryApp); 
        console.error("Erro ao criar colaborador:", error);
        if (error.code === 'auth/email-already-in-use') {
            throw new Error("Este nome de usuário já está em uso.");
        }
        throw error;
    }
};

// --- Users Collection ---

export const saveUserToDB = async (user: User) => {
  if (!user || !user.id) {
      console.error("Tentativa de salvar usuário inválido ou sem ID:", user);
      return;
  }
  try {
    const userData = cleanData(user);
    if (!userData.allowedPlans) userData.allowedPlans = [];
    if (!userData.allowedSimuladoClasses) userData.allowedSimuladoClasses = [];
    if (!userData.progress) {
        userData.progress = { 
            completedGoalIds: [], 
            completedRevisionIds: [], 
            totalStudySeconds: 0, 
            planStudySeconds: {} 
        };
    }
    
    await setDoc(doc(db, "users", String(user.id)), userData);
    console.log("Usuário salvo/atualizado com sucesso:", user.id);
  } catch (e) {
    console.error("Erro ao salvar usuário: ", e);
  }
};

export const fetchUsersFromDB = async (): Promise<User[]> => {
  try {
    const querySnapshot = await getDocs(collection(db, "users"));
    const users: User[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data() as User;
      if (!data.id) data.id = doc.id;
      users.push(data);
    });
    return users;
  } catch (e) {
    console.error("Erro ao buscar usuários: ", e);
    return [];
  }
};

// NEW: Helper to get full user profile after Firebase Auth Login
export const getUserByEmail = async (email: string): Promise<User | null> => {
    const normalizedEmail = email.toLowerCase().trim();

    // FAILSAFE ADMIN: Se o banco falhar (regras), garantimos o admin em memória
    // Isso impede que o admin fique trancado para fora se as regras estiverem erradas
    if (normalizedEmail === ADMIN_EMAIL.toLowerCase()) {
        try {
            console.log("Admin detectado, tentando busca direta...");
            const adminDocRef = doc(db, "users", "admin_1");
            const adminSnap = await getDoc(adminDocRef);
            
            if (adminSnap.exists()) {
                const data = adminSnap.data() as User;
                return { ...data, id: "admin_1", isAdmin: true };
            }
        } catch (e: any) {
            console.error("Erro ao ler banco do admin:", e);
            // Se der erro de permissão no Admin, retornamos um objeto Admin de emergência
            // para permitir que ele entre e veja os erros no console/dashboard
            if (e.code === 'permission-denied') {
                console.warn("ALERTA: Permissão negada no Firestore. Logando Admin em modo de emergência.");
                return {
                    id: 'admin_1',
                    name: 'Administrador (Modo Emergência)',
                    email: ADMIN_EMAIL,
                    cpf: '000',
                    level: 'avancado',
                    isAdmin: true,
                    allowedPlans: [],
                    allowedSimuladoClasses: [],
                    planExpirations: {},
                    simuladoExpirations: {},
                    planConfigs: {},
                    routine: { days: {} },
                    progress: { completedGoalIds: [], completedRevisionIds: [], totalStudySeconds: 0, planStudySeconds: {} }
                };
            }
        }
    }

    try {
        const q = query(collection(db, "users"), where("email", "==", normalizedEmail));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) return null;
        
        // Return the first match
        const docSnap = querySnapshot.docs[0];
        const userData = docSnap.data() as User;
        if (!userData.id) userData.id = docSnap.id;
        
        return userData;
    } catch (e: any) {
        console.error("Erro ao buscar user por email:", e.code || e.message);
        if (e.code === 'permission-denied') {
            throw new Error("FIREBASE_RULES_ERROR");
        }
        return null;
    }
};

export const deleteUserFromDB = async (userId: string) => {
    try {
        await deleteDoc(doc(db, "users", userId));
    } catch (e) {
        console.error("Erro ao deletar usuário:", e);
        throw e;
    }
}

// --- Plans Collection ---

export const savePlanToDB = async (plan: StudyPlan) => {
  if (!plan || !plan.id) return;
  try {
    await setDoc(doc(db, "plans", plan.id), cleanData(plan));
    console.log("Plano sincronizado com sucesso:", plan.name);
  } catch (e) {
    console.error("Erro ao salvar plano: ", e);
    throw e;
  }
};

export const fetchPlansFromDB = async (): Promise<StudyPlan[]> => {
  try {
    const querySnapshot = await getDocs(collection(db, "plans"));
    const plans: StudyPlan[] = [];
    querySnapshot.forEach((doc) => {
      plans.push(doc.data() as StudyPlan);
    });
    return plans;
  } catch (e) {
    console.error("Erro ao buscar planos: ", e);
    return [];
  }
};

export const deletePlanFromDB = async (planId: string) => {
    try {
        await deleteDoc(doc(db, "plans", planId));
        console.log("Plano deletado:", planId);
    } catch (e) {
        console.error("Erro ao deletar plano:", e);
        throw e;
    }
};

// --- SETTINGS (CATEGORIES) ---

export const saveCategoryConfig = async (categories: CategoryDefinition[]) => {
    try {
        await setDoc(doc(db, "settings", "categories"), { items: categories });
    } catch (e) {
        console.error("Erro ao salvar categorias:", e);
    }
};

export const fetchCategoryConfig = async (): Promise<CategoryDefinition[]> => {
    try {
        const snap = await getDoc(doc(db, "settings", "categories"));
        if (snap.exists()) {
            return snap.data().items as CategoryDefinition[];
        }
        // Retornar padrão se não existir
        return [
            { name: 'CARREIRAS_POLICIAIS', subCategories: [] },
            { name: 'CARREIRAS_TRIBUNAIS', subCategories: [] },
            { name: 'CARREIRAS_ADMINISTRATIVAS', subCategories: [] },
            { name: 'CARREIRAS_JURIDICAS', subCategories: [] },
            { name: 'ENEM', subCategories: [] },
            { name: 'OUTROS', subCategories: [] }
        ];
    } catch (e) {
        console.error("Erro ao buscar categorias:", e);
        return [];
    }
};

// --- SIMULADOS COLLECTIONS ---

export const saveSimuladoClassToDB = async (simClass: SimuladoClass) => {
    if(!simClass || !simClass.id) return;
    try {
        await setDoc(doc(db, "simulados_classes", simClass.id), cleanData(simClass));
    } catch (e) {
        console.error("Error saving Simulado Class:", e);
        throw e;
    }
}

export const fetchSimuladoClassesFromDB = async (): Promise<SimuladoClass[]> => {
    try {
        const q = await getDocs(collection(db, "simulados_classes"));
        const list: SimuladoClass[] = [];
        q.forEach(d => list.push(d.data() as SimuladoClass));
        return list;
    } catch (e) {
        console.error("Error fetching Simulado Classes:", e);
        return [];
    }
}

export const deleteSimuladoClassFromDB = async (id: string) => {
    try {
        await deleteDoc(doc(db, "simulados_classes", id));
    } catch (e) {
        console.error("Error deleting Simulado Class:", e);
        throw e;
    }
}

export const saveSimuladoAttemptToDB = async (attempt: SimuladoAttempt) => {
    if(!attempt || !attempt.id) return;
    try {
        await setDoc(doc(db, "simulados_attempts", attempt.id), cleanData(attempt));
    } catch (e) {
        console.error("Error saving Attempt:", e);
        throw e;
    }
}

export const fetchSimuladoAttemptsFromDB = async (): Promise<SimuladoAttempt[]> => {
    try {
        const q = await getDocs(collection(db, "simulados_attempts"));
        const list: SimuladoAttempt[] = [];
        q.forEach(d => list.push(d.data() as SimuladoAttempt));
        return list;
    } catch (e) {
        console.error("Error fetching Attempts:", e);
        return [];
    }
}

// --- BACKUP & RESTORE SYSTEM ---

export const exportFullDatabase = async (): Promise<DatabaseBackup> => {
    const [users, plans, classes, attempts] = await Promise.all([
        fetchUsersFromDB(),
        fetchPlansFromDB(),
        fetchSimuladoClassesFromDB(),
        fetchSimuladoAttemptsFromDB()
    ]);

    return {
        version: "1.0.0",
        timestamp: new Date().toISOString(),
        users,
        plans,
        simulados_classes: classes,
        simulados_attempts: attempts
    };
};

export const createCloudSnapshot = async (label: string, userId: string): Promise<CloudBackup> => {
    try {
        const data = await exportFullDatabase();
        const timestamp = new Date().toISOString();
        const filename = `snapshot_${timestamp.replace(/[:.]/g, '-')}.json`;
        
        // Upload JSON blob to Storage
        const url = await uploadJSONBackup(data, filename);

        // Save Metadata to Firestore
        const backup: CloudBackup = {
            id: `snap_${Date.now()}`,
            label,
            createdAt: timestamp,
            url,
            version: data.version,
            createdBy: userId
        };

        await setDoc(doc(db, "system_backups", backup.id), backup);
        return backup;
    } catch (e) {
        console.error("Erro ao criar snapshot na nuvem:", e);
        throw e;
    }
};

export const getCloudSnapshots = async (): Promise<CloudBackup[]> => {
    try {
        const q = query(collection(db, "system_backups"));
        const snap = await getDocs(q);
        const backups: CloudBackup[] = [];
        snap.forEach(d => backups.push(d.data() as CloudBackup));
        // Sort descending by date
        return backups.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (e) {
        console.error("Erro ao buscar snapshots:", e);
        return [];
    }
};

export const deleteCloudSnapshot = async (id: string) => {
    try {
        await deleteDoc(doc(db, "system_backups", id));
    } catch (e) {
        console.error("Erro ao deletar snapshot:", e);
        throw e;
    }
};

export const restoreFromCloudSnapshot = async (backup: CloudBackup) => {
    try {
        const response = await fetch(backup.url);
        if (!response.ok) throw new Error("Falha ao baixar arquivo de backup.");
        const data = await response.json() as DatabaseBackup;
        await importFullDatabase(data);
    } catch (e) {
        console.error("Erro na restauração via nuvem:", e);
        throw e;
    }
};

export const importFullDatabase = async (backup: DatabaseBackup) => {
    try {
        console.log("Iniciando Restauração do Ponto de Controle...");
        
        // 1. Limpar banco atual
        await resetFullDatabase();

        // 2. Restaurar em lotes
        const collections = [
            { name: "users", data: backup.users },
            { name: "plans", data: backup.plans },
            { name: "simulados_classes", data: backup.simulados_classes },
            { name: "simulados_attempts", data: backup.simulados_attempts }
        ];

        for (const col of collections) {
            if (!col.data || col.data.length === 0) continue;
            
            const CHUNK_SIZE = 400;
            for (let i = 0; i < col.data.length; i += CHUNK_SIZE) {
                const chunk = col.data.slice(i, i + CHUNK_SIZE);
                const batch = writeBatch(db);
                chunk.forEach((item: any) => {
                    const docRef = doc(db, col.name, item.id);
                    batch.set(docRef, cleanData(item));
                });
                await batch.commit();
            }
        }
        
        console.log("Restauração concluída com sucesso.");
    } catch (e) {
        console.error("Erro na restauração:", e);
        throw e;
    }
};

export const resetFullDatabase = async () => {
    try {
        console.log(">>> LIMPANDO BANCO DE DADOS PARA RESTAURAÇÃO...");
        const collectionsToCheck = ["plans", "users", "simulados_classes", "simulados_attempts"];
        for (const colName of collectionsToCheck) {
            const snapshot = await getDocs(collection(db, colName));
            const CHUNK_SIZE = 400;
            const docs = snapshot.docs;
            for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
                const chunk = docs.slice(i, i + CHUNK_SIZE);
                const batch = writeBatch(db);
                chunk.forEach(d => batch.delete(d.ref));
                await batch.commit();
            }
        }
    } catch (e: any) {
        console.error(">>> ERRO NO RESET:", e);
        throw e;
    }
};

export const authenticateUserDB = async (email: string, password: string): Promise<User | null> => {
    try {
        const normalizedEmail = email.toLowerCase().trim();
        // Fallback for query permission: if admin, check admin_1
        if (normalizedEmail === ADMIN_EMAIL.toLowerCase()) {
             const docRef = doc(db, "users", "admin_1");
             const snap = await getDoc(docRef);
             if (snap.exists()) {
                 const u = snap.data() as User;
                 if (u.tempPassword === password) return u;
             }
        }

        const q = query(collection(db, "users"), where("email", "==", normalizedEmail));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) return null;
        
        let foundUser: User | null = null;
        querySnapshot.forEach((doc) => {
            const userData = doc.data() as User;
            if (!userData.id) userData.id = doc.id;
            if (userData.tempPassword === password) {
                foundUser = userData;
            }
        });
        return foundUser;
    } catch (e: any) {
        console.error("Erro na autenticação legada:", e);
        throw e;
    }
}
