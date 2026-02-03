
import { storage, auth } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { uuid } from '../constants';

export const uploadFileToStorage = async (file: File, folder: string = 'materials'): Promise<string> => {
    if (!file) throw new Error("Nenhum arquivo fornecido.");

    // 1. Verificação de Segurança Local
    // O Storage exige autenticação. Se o usuário caiu ou o token expirou, paramos aqui.
    if (!auth.currentUser) {
        throw new Error("Sessão expirada. Por favor, recarregue a página e faça login novamente.");
    }

    // Create a unique filename: materials/randomID-filename.pdf
    // Remove special chars to avoid storage issues
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filename = `${folder}/${uuid()}-${safeName}`;
    const storageRef = ref(storage, filename);

    // Metadata is crucial for Firebase Storage Rules and browser handling
    // Simplificamos para evitar conflitos de tipo mime estritos
    const metadata = {
        contentType: file.type || 'application/octet-stream',
        customMetadata: {
            uploadedBy: auth.currentUser.uid,
            originalName: file.name
        }
    };

    try {
        console.log(`Iniciando upload de ${file.name} para ${filename}...`);
        const snapshot = await uploadBytes(storageRef, file, metadata);
        const downloadURL = await getDownloadURL(snapshot.ref);
        console.log("Upload concluído:", downloadURL);
        return downloadURL;
    } catch (error: any) {
        console.error("Erro detalhado no upload do arquivo:", error);
        
        if (error.code === 'storage/unauthorized') {
            throw new Error("Permissão negada pelo servidor (Storage). Verifique as Regras de Segurança no Console Firebase.");
        } else if (error.code === 'storage/canceled') {
            throw new Error("Upload cancelado.");
        } else if (error.code === 'storage/unknown') {
            // Frequentemente causado por CORS
            throw new Error("Erro de comunicação. Se estiver rodando localmente, verifique as configurações de CORS do seu bucket.");
        } else if (error.message.includes("network")) {
             throw new Error("Erro de rede. Verifique sua conexão ou configuração de CORS do Firebase.");
        }
        
        throw new Error(`Falha no upload: ${error.message || "Erro desconhecido"}`);
    }
};

export const uploadJSONBackup = async (data: any, filename: string): Promise<string> => {
    if (!auth.currentUser) {
        throw new Error("Você precisa estar logado para salvar backups.");
    }

    try {
        const jsonString = JSON.stringify(data);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const storageRef = ref(storage, `backups/${filename}`);
        
        const metadata = { 
            contentType: 'application/json',
            customMetadata: {
                uploadedBy: auth.currentUser.uid
            }
        };
        
        const snapshot = await uploadBytes(storageRef, blob, metadata);
        return await getDownloadURL(snapshot.ref);
    } catch (error: any) {
        console.error("Erro ao salvar backup no storage:", error);
        if (error.code === 'storage/unauthorized') {
            throw new Error("Erro de permissão: Login de Admin necessário.");
        }
        throw new Error("Falha ao criar arquivo de backup na nuvem.");
    }
};
