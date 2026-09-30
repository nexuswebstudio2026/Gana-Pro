interface OrgNodeData { id: string; name: string; email?: string; position: number; depth: number; level?: string; role?: string; children: OrgNodeData[]; }

/* Interactividad del organigrama: vista foco (raiz + 5 directos), zoom, buscador y ramas colapsables. Importado por OrgChartPanel.astro; Astro/Vite lo empaqueta y compila el TS. */
(() => {
					const dataEl = document.querySelector('[data-org-data]');
					let root: OrgNodeData | null = null;
					try {
						root = JSON.parse(dataEl?.textContent || 'null');
					} catch {
						root = null;
					}
					if (!root) return;
					const byId = new Map<string, OrgNodeData>();
					const pathOf = new Map<string, string[]>();
					(pathOf.set(root.id, [root.id]), byId.set(root.id, root));
					const stack = [root];
					while (stack.length > 0) {
						const node = stack.pop() as OrgNodeData | undefined;
						if (!node) continue;
						(node.children || []).forEach((child) => {
							byId.set(child.id, child);
							pathOf.set(child.id, [...(pathOf.get(node.id) || []), child.id]);
							stack.push(child);
						});
					}

					const tree = document.querySelector<HTMLElement>('[data-org-tree]');
					const panelHost = tree?.closest('.org-panel') as HTMLElement | null;
					const panel: HTMLElement | Document = panelHost ?? document;
					const focusBox = (panel as unknown as ParentNode).querySelector<HTMLElement>('[data-org-focus]');
					const focusName = (panel as unknown as ParentNode).querySelector<HTMLElement>('[data-org-focus-name]');
					const focusSub = (panel as unknown as ParentNode).querySelector<HTMLElement>('[data-org-focus-sub]');
					const focusGrid = (panel as unknown as ParentNode).querySelector<HTMLElement>('[data-org-focus-grid]');
					const crumbs = (panel as unknown as ParentNode).querySelector<HTMLElement>('[data-org-crumbs]');
					const backBtn = (panel as unknown as ParentNode).querySelector<HTMLButtonElement>('[data-org-back]');
					const homeBtn = (panel as unknown as ParentNode).querySelector<HTMLButtonElement>('[data-org-home]');
					const search = (panel as unknown as ParentNode).querySelector<HTMLInputElement>('[data-org-search]');
					const result = (panel as unknown as ParentNode).querySelector<HTMLElement>('[data-org-result]');
					const label = (panel as unknown as ParentNode).querySelector<HTMLElement>('[data-org-zoom-label]');
					let currentId = root.id;
					let zoom = 1;

					const initialsOf = (name: string) =>
						String(name || '')
							.split(/[\s_.-]+/)
							.filter(Boolean)
							.slice(0, 2)
							.map((part) => part.charAt(0).toUpperCase())
							.join('') || '·';

					const countDescendants = (node: OrgNodeData): number =>
						(node.children || []).reduce((total: number, child: OrgNodeData) => total + 1 + countDescendants(child), 0);

					const renderFocus = () => {
						const node = byId.get(currentId) || root;
						currentId = node.id;
						const kids = node.children || [];
						if (focusName) focusName.textContent = node.name || 'Equipo';
						if (focusSub) {
							const detail = node.id === root.id
								? `${kids.length} directos · ${countDescendants(node)} en su red`
								: [
										node.email || '',
										`${kids.length} directo${kids.length === 1 ? '' : 's'}`,
										`${countDescendants(node)} en su red`,
									]
										.filter(Boolean)
										.join(' · ');
							focusSub.textContent = detail;
						}
						if (backBtn) {
							const path = pathOf.get(node.id) || [root.id];
							backBtn.hidden = path.length <= 1;
						}
						if (crumbs) {
							crumbs.innerHTML = '';
							(pathOf.get(node.id) || [root.id]).forEach((id: string, index: number, arr: string[]) => {
								const item = byId.get(id);
								if (!item) return;
								if (index > 0) {
									const sep = document.createElement('span');
									sep.className = 'org-crumb-sep';
									sep.textContent = '›';
									sep.setAttribute('aria-hidden', 'true');
									crumbs.appendChild(sep);
								}
								const btn = document.createElement('button');
								btn.type = 'button';
								btn.className = 'org-crumb' + (index === arr.length - 1 ? ' is-current' : '');
								btn.textContent = item.name;
								btn.setAttribute('aria-current', index === arr.length - 1 ? 'page' : 'false');
								btn.addEventListener('click', () => {
									currentId = id;
									renderFocus();
								});
								crumbs.appendChild(btn);
							});
						}
						if (focusGrid) {
							focusGrid.innerHTML = '';
							if (kids.length === 0) {
								const empty = document.createElement('p');
								empty.className = 'org-empty';
								empty.textContent = `${node.name} aún no tiene usuarios directos asignados.`;
								focusGrid.appendChild(empty);
							} else {
								kids.slice(0, 5).forEach((child: OrgNodeData, index: number) => {
									const card = document.createElement('button');
									card.type = 'button';
									card.className = 'org-focus-card';
									card.setAttribute('data-org-focus-pick', child.id);
									const grandkids = (child.children || []).length;
									card.innerHTML =
										`<span class="org-focus-slot">Puesto ${index + 1} de 5</span>` +
										`<span class="org-avatar" aria-hidden="true">${initialsOf(child.name)}</span>` +
										`<strong>${child.name}</strong>` +
										`<span class="org-focus-meta">${[child.level, child.role].filter(Boolean).join(' · ') || `Registro #${child.position}`}</span>` +
										(child.email ? `<span class="org-email">${child.email}</span>` : '') +
										`<span class="org-pos">${grandkids} equipo${grandkids === 1 ? '' : 's'} · ver ›</span>`;
									card.addEventListener('click', () => {
										currentId = child.id;
										renderFocus();
									});
									focusGrid.appendChild(card);
								});
								for (let i = kids.length; i < 5; i++) {
									const vacant = document.createElement('div');
									vacant.className = 'org-focus-card is-vacant';
									vacant.innerHTML =
										`<span class="org-focus-slot">Puesto ${i + 1} de 5</span>` +
										`<span class="org-avatar" aria-hidden="true">○</span>` +
										`<strong>Puesto disponible</strong>` +
										`<span class="org-focus-meta">Sin asignar</span>`;
									focusGrid.appendChild(vacant);
								}
							}
						}
						syncTreeSelection();
					};

					const syncTreeSelection = () => {
						if (!tree) return;
						tree.querySelectorAll<HTMLElement>('[data-org-node]').forEach((branch) => {
							branch.classList.toggle('is-selected', branch.dataset.orgNode === currentId);
						});
					};

					backBtn?.addEventListener('click', () => {
						const path = pathOf.get(currentId) || [root.id];
						currentId = path.length > 1 ? path[path.length - 2] : root.id;
						renderFocus();
					});
					homeBtn?.addEventListener('click', () => {
						currentId = root.id;
						renderFocus();
					});
					(panel as unknown as ParentNode).querySelector('[data-org-tree-toggle]')?.addEventListener('click', (event) => {
						const btn = event.currentTarget as unknown as HTMLButtonElement | null;
						const scroll = (panel as unknown as ParentNode).querySelector('[data-org-scroll]');
						if (!(scroll instanceof HTMLElement) || !btn) return;
						const open = (scroll as HTMLElement).hidden;
						scroll.hidden = !open;
						btn.setAttribute('aria-expanded', String(open));
						btn.textContent = open ? 'Ocultar árbol completo' : 'Ver árbol completo';
						if (open) scroll.scrollIntoView({ behavior: 'smooth', block: 'start' });
					});

					const applyZoom = () => {
						if (!tree) return;
						tree.style.setProperty('--org-zoom', String(zoom));
						if (label) label.textContent = `${Math.round(zoom * 100)}%`;
					};

					const setCollapsed = (branch: Element, collapsed: boolean): void => {
						const kidsEl = branch.querySelector<HTMLElement>(':scope > .org-children');
						const btnEl = branch.querySelector<HTMLElement>(':scope > .org-node [data-org-toggle]');
						if (!kidsEl || !btnEl) return;
						kidsEl.hidden = collapsed;
						btnEl.textContent = collapsed ? '+' : '−';
						btnEl.setAttribute('aria-expanded', String(!collapsed));
						const branchName = (branch as HTMLElement).dataset.orgName || 'equipo';
						btnEl.setAttribute(
							'aria-label',
							collapsed ? `Expandir equipo de ${branchName}` : `Contraer equipo de ${branchName}`
						);
					};

					tree?.addEventListener('click', (event) => {
						const target = event.target instanceof Element ? event.target : null;
						const toggle = target?.closest('[data-org-toggle]');
						if (toggle) {
							const branch = toggle.closest('.org-branch');
							if (!branch) return;
							const kids = branch.querySelector(':scope > .org-children');
							if (!kids) return;
							event.preventDefault();
							event.stopPropagation();
							setCollapsed(branch, !(kids as unknown as HTMLElement).hidden);
							return;
						}
						const selectBtn = target?.closest('[data-org-select]');
						if (selectBtn) {
							const id = selectBtn.getAttribute('data-org-select');
							if (id && byId.has(id)) {
								currentId = id;
								renderFocus();
								focusBox?.scrollIntoView({ behavior: 'smooth', block: 'start' });
							}
						}
					});

					(panel as unknown as ParentNode).querySelector('[data-org-zoom-in]')?.addEventListener('click', () => {
						zoom = Math.min(1.8, +(zoom + 0.15).toFixed(2));
						applyZoom();
					});
					(panel as unknown as ParentNode).querySelector('[data-org-zoom-out]')?.addEventListener('click', () => {
						zoom = Math.max(0.5, +(zoom - 0.15).toFixed(2));
						applyZoom();
					});
					(panel as unknown as ParentNode).querySelector('[data-org-zoom-reset]')?.addEventListener('click', () => {
						zoom = 1;
						applyZoom();
						if (search) {
							search.value = '';
							search.dispatchEvent(new Event('input', { bubbles: true }));
						}
					});
					(panel as unknown as ParentNode).querySelector('[data-org-collapse-all]')?.addEventListener('click', () => {
						tree?.querySelectorAll<HTMLElement>('.org-branch').forEach((branch) => {
							if (branch.classList.contains('org-root')) return;
							setCollapsed(branch, true);
						});
					});
					(panel as unknown as ParentNode).querySelector('[data-org-expand-all]')?.addEventListener('click', () => {
						tree?.querySelectorAll('.org-branch').forEach((branch) => setCollapsed(branch, false));
					});

					search?.addEventListener('input', () => {
						const q = search.value.trim().toLowerCase();
						const nodes: HTMLElement[] = [...(tree?.querySelectorAll<HTMLElement>('[data-org-node]') || [])];
						if (!q) {
							nodes.forEach((node) => node.classList.remove('is-dimmed', 'is-match'));
							if (result) result.hidden = true;
							return;
						}
						let matches = 0;
						let first: HTMLElement | null = null;
						nodes.forEach((node: HTMLElement) => {
							const hit =
								(node.dataset.orgName || '').includes(q) ||
								(node.dataset.orgEmail || '').includes(q);
							node.classList.toggle('is-match', hit);
							node.classList.toggle('is-dimmed', !hit);
							if (hit) {
								matches += 1;
								if (!first) first = node;
								let parent = node.parentElement?.closest('.org-branch');
								while (parent) {
									setCollapsed(parent, false);
									parent.classList.remove('is-dimmed');
									parent = parent.parentElement?.closest('.org-branch') || null;
								}
							}
						});
						if (result) {
							result.hidden = false;
							result.textContent =
								matches === 0
									? `Sin coincidencias para “${search.value.trim()}”.`
									: `${matches} coincidencia${matches === 1 ? '' : 's'} para “${search.value.trim()}”.`;
						}
						if (first) {
							const foundId = (first as HTMLElement).dataset.orgNode as string;
							const foundPath = pathOf.get(foundId) || [];
							const foundNode = byId.get(foundId);
							if (foundNode && (foundNode.children || []).length > 0) {
								currentId = foundId;
							} else if (foundPath.length > 1) {
								currentId = foundPath[foundPath.length - 2];
							}
							renderFocus();
							focusBox?.scrollIntoView({ behavior: 'smooth', block: 'start' });
						}
					});

					renderFocus();
					applyZoom();
				})();
