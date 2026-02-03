
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
