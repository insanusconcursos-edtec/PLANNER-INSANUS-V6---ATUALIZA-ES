
import React, { useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, deleteUser, signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { authenticateUserDB, getUserByEmail } from '../services/db';
import { User } from '../types';
import { Icon } from '../components/Icons';

interface LoginScreenProps {
    onLogin: (user: User) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');
        setStatusMessage('Autenticando...');

        // LOGIC: Identity Masquerading
        // Se não tiver @, assume que é um colaborador e adiciona o sufixo interno
        const loginEmail = email.includes('@') ? email : `${email}@staff.insanus`;

        try {
            // 1. Tentar login direto no Firebase Auth
            const userCredential = await signInWithEmailAndPassword(auth, loginEmail, password);
            setStatusMessage('Carregando perfil...');
            const userData = await getUserByEmail(userCredential.user.email!);
            
            if (userData) {
                onLogin(userData);
            } else {
                setError("Perfil de usuário não encontrado.");
                setIsLoading(false);
                setStatusMessage('');
                await signOut(auth);
            }

        } catch (authError: any) {
            // 2. Se falhar, verificar se é primeiro acesso (Usuário no DB mas não no Auth)
            // auth/user-not-found ou auth/invalid-credential
            if (authError.code === 'auth/user-not-found' || authError.code === 'auth/invalid-credential' || authError.code === 'auth/wrong-password') {
                try {
                    setStatusMessage('Verificando credenciais...');
                    
                    // Verifica se existe no Firestore com senha temporária
                    // Note: authenticateUserDB is legacy for migrated users, likely won't work for staff masquerade initial login
                    // but we keep it for consistency with student flow
                    const dbUser = await authenticateUserDB(loginEmail, password);

                    if (dbUser) {
                        setStatusMessage('Criando acesso seguro...');
                        // Cria usuário no Auth
                        await createUserWithEmailAndPassword(auth, loginEmail, password);
                        
                        // Login sucesso
                        onLogin(dbUser);
                    } else {
                        // Se não achou no DB ou senha errada
                        // For staff masquerading, getting here means auth failed and DB check failed.
                        const userExists = await getUserByEmail(loginEmail);
                        if (!userExists) {
                            throw new Error("E-mail não cadastrado pelo administrador.");
                        } else {
                            throw new Error("Senha inicial inválida.");
                        }
                    }

                } catch (createError: any) {
                     // Se falhar a criação ou a verificação
                     if (createError.message === "FIREBASE_RULES_ERROR") throw createError;

                     if (auth.currentUser) await signOut(auth); // Garantir logout
                     
                     if (createError.code === 'auth/email-already-in-use') {
                         setError("E-mail já cadastrado, mas a senha está incorreta.");
                         setStatusMessage('');
                         setIsLoading(false);
                     } else if (createError.message === "E-mail não cadastrado pelo administrador.") {
                         setError("Este usuário não possui acesso ativo.");
                         setStatusMessage('');
                         setIsLoading(false);
                     } else if (createError.message === "Senha inicial inválida.") {
                         if (auth.currentUser) await deleteUser(auth.currentUser); 
                         setError("A senha informada não confere.");
                         setStatusMessage('');
                         setIsLoading(false);
                     } else {
                         // Joga o erro original de login (Senha incorreta) se não foi resolvido pelo DB check
                         setError("Credenciais inválidas.");
                         setStatusMessage('');
                         setIsLoading(false);
                     }
                }
            } else {
                // Outro erro de Auth (too many requests, network, etc)
                console.error(authError);
                setError("Erro de conexão ou acesso bloqueado temporariamente.");
                setStatusMessage('');
                setIsLoading(false);
            }
        }
    };

    return (
        <div className="flex flex-col items-center justify-center w-full h-full p-4 relative z-10">
            <div className="w-full max-w-md bg-[#0A0A0A] border border-red-900/30 p-8 rounded-3xl shadow-[0_0_60px_-15px_rgba(220,38,38,0.2)] relative overflow-hidden backdrop-blur-xl transition-all hover:border-red-600/40 hover:shadow-[0_0_80px_-10px_rgba(220,38,38,0.3)]">
                
                {/* Background Grid Pattern inside the card */}
                <div 
                    className="absolute inset-0 opacity-[0.07] pointer-events-none" 
                    style={{ 
                        backgroundImage: 'linear-gradient(#ff1f1f 1px, transparent 1px), linear-gradient(90deg, #ff1f1f 1px, transparent 1px)', 
                        backgroundSize: '24px 24px' 
                    }}
                ></div>

                {/* Decoration Lines */}
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-insanus-red to-transparent opacity-80 shadow-[0_0_15px_#ff1f1f]"></div>
                <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-red-900/50 to-transparent"></div>
                
                <div className="relative z-10 flex flex-col items-center mb-8">
                    <div className="w-16 h-16 bg-gradient-to-br from-red-900/20 to-black rounded-full flex items-center justify-center shadow-[0_0_25px_rgba(220,38,38,0.3)] mb-4 border border-red-500/20">
                        <Icon.User className="w-8 h-8 text-insanus-red drop-shadow-md" />
                    </div>
                    <h1 className="text-3xl font-black text-white uppercase tracking-tighter drop-shadow-sm">Área de Acesso</h1>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-[0.3em] mt-2 text-insanus-red">Insanus Planner</p>
                </div>

                <form onSubmit={handleLogin} className="space-y-5 relative z-10">
                    <div>
                        <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Usuário ou E-mail</label>
                        <div className="relative group">
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 group-focus-within:text-insanus-red transition-colors">
                                <Icon.User className="w-4 h-4"/>
                            </div>
                            <input 
                                type="text" 
                                value={email} 
                                onChange={(e) => setEmail(e.target.value)} 
                                className="w-full bg-[#050505]/80 border border-[#333] rounded-xl py-3.5 pl-10 pr-4 text-white text-sm focus:border-insanus-red focus:bg-black focus:outline-none transition-all placeholder-gray-700 shadow-inner" 
                                placeholder="usuário ou email@..." 
                                required 
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Senha</label>
                        <div className="relative group">
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 group-focus-within:text-insanus-red transition-colors">
                                <Icon.LogOut className="w-4 h-4 rotate-90"/> {/* Key icon substitute */}
                            </div>
                            <input 
                                type={showPassword ? "text" : "password"}
                                value={password} 
                                onChange={(e) => setPassword(e.target.value)} 
                                className="w-full bg-[#050505]/80 border border-[#333] rounded-xl py-3.5 pl-10 pr-10 text-white text-sm focus:border-insanus-red focus:bg-black focus:outline-none transition-all placeholder-gray-700 shadow-inner" 
                                placeholder="••••••••" 
                                required 
                            />
                            <button 
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-white transition-colors cursor-pointer p-1 rounded hover:bg-white/5"
                            >
                                {showPassword ? <Icon.EyeOff className="w-4 h-4" /> : <Icon.Eye className="w-4 h-4" />}
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="p-3 bg-red-950/30 border border-red-500/30 rounded-lg flex items-center gap-3 animate-fade-in">
                            <Icon.Trash className="w-4 h-4 text-red-500 shrink-0" />
                            <p className="text-red-400 text-xs font-bold leading-tight">{error}</p>
                        </div>
                    )}

                    {statusMessage && !error && (
                        <div className="p-3 bg-blue-950/30 border border-blue-500/30 rounded-lg flex items-center gap-3 justify-center animate-fade-in">
                            <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                            <p className="text-blue-400 text-xs font-bold uppercase tracking-widest">{statusMessage}</p>
                        </div>
                    )}

                    <button 
                        type="submit" 
                        disabled={isLoading}
                        className="w-full bg-gradient-to-r from-insanus-red to-red-700 hover:from-red-600 hover:to-red-800 text-white font-black py-4 rounded-xl shadow-[0_0_20px_rgba(220,38,38,0.4)] hover:shadow-[0_0_30px_rgba(220,38,38,0.6)] transition-all transform hover:scale-[1.02] active:scale-[0.98] uppercase tracking-widest text-xs flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                    >
                        {isLoading ? 'Acessando...' : 'Entrar na Plataforma'}
                    </button>
                </form>

                <div className="mt-8 text-center relative z-10 border-t border-white/5 pt-6">
                    <p className="text-[10px] text-gray-500 font-medium mb-2">Não tem acesso ou esqueceu a senha?</p>
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:border-insanus-red/50 transition-colors group cursor-pointer">
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider group-hover:text-gray-300">Suporte:</span>
                        <a href="mailto:pedagogico.insanus@gmail.com" className="text-[10px] font-bold text-insanus-red group-hover:text-white transition-colors">
                            pedagogico.insanus@gmail.com
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
};