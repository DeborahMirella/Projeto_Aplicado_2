# SUS+ — protótipo acadêmico

## Implementação atual
- Interface responsiva com navegação entre Início, Área do cidadão, Área do gestor e Sobre/fontes.
- Importação automática dos arquivos reais disponíveis na pasta `Base de Dados`.
- Importação administrativa adicional de CSV, XLS e XLSX por token no servidor.
- Armazenamento em SQLite com metadados de categoria, fonte, arquivo, período e quantidade de registros.
- Busca textual sem distinção de maiúsculas/minúsculas e sem acentos.
- Filtros por campos existentes e combinação E (AND) ou OU (OR).
- Exibição de estabelecimentos CNES com coordenadas válidas vinculadas ao OpenStreetMap.
- Painel do gestor com cartões, gráficos de competência e tabelas de produção.
- Remoção de CNS e matrícula funcional dos dados importados e publicados.

## Dados importados e validados
- CNES: `7423` estabelecimentos únicos de Belo Horizonte; sem duplicidade de CNES detectada.
- SIAPS APS: `8` competências consolidadas em janeiro–agosto de 2026.
- SIAPS ACS: `8` competências consolidadas em janeiro–agosto de 2026; uma duplicidade exata foi removida.
- Monitoramento SIAPS: `147` registros municipais efetivos nas abas Estabelecimentos, Equipes e ACS; dados administrativos de AGO/2026.
- SIA/SUS: `1` registro municipal válido, quantidade aprovada `6886771` em Ago/2026. A linha “Total” não foi contabilizada.
- SISAB: `1` registro municipal válido de Belo Horizonte, com valores consolidados de produção em competências de JAN/2026 a SET/2026.

O SISAB contém 5582 linhas nacionais no relatório original, mas o protótipo importa apenas a linha municipal de Belo Horizonte. Os dados originais não são alterados.

## Estrutura dos arquivos
- CNES: CSV UTF-8 com cabeçalho na primeira linha e delimitador `;`.
- SIA/SUS: CSV CP1252 com títulos e metadados antes do cabeçalho. O cabeçalho real está na linha 5.
- SISAB: CSV CP1252 com metadados nas primeiras linhas. O cabeçalho real está na linha 8.
- Coberturas SIAPS: XLSX com uma aba `Dados` e cabeçalho na primeira linha.
- Monitoramento SIAPS: XLSX com três abas relevantes: `Estabelecimentos`, `Equipes` e `ACS`.

## Como executar
Requer Node.js 18 ou superior.

1. Abra um terminal na pasta `sus_mais_entregas`.
2. Execute `npm install`.
3. Configure um token administrativo: `ADMIN_TOKEN='uma-chave-local' npm start`.
4. Acesse `http://localhost:3000`.

Sem variável de ambiente, o token de demonstração é `troque-este-token`. Não é adequado para produção.

## Validações realizadas
- Sintaxe dos arquivos JavaScript verificada com `node --check`.
- Importação automática dos seis arquivos reais validada pelo endpoint `/api/datasets`.
- Busca por bairro, nome, CNES e código municipal executada.
- Painel analítico carregado em `/api/dashboard`.
- Percentuais ACS, capacidades APS e tabelas SISAB/SIA/SUS carregados a partir dos dados reais.
- CNS não aparece nas consultas públicas.

## Limitações conhecidas
- Não existe base validada de profissionais da SMSA neste conjunto. Profissionais não foram inventados.
- Não há correspondência validada entre unidades da SMSA e estabelecimentos CNES além do código municipal.
- O arquivo APS contém capacidade por equipe, mas o campo `Cobertura APS` está vazio nas linhas originais; o protótipo não inventa valores.
- Cobertura APS e ACS são estimativas; não contam pessoas efetivamente atendidas.
- SISAB e SIA/SUS representam produções com conceitos diferentes e são exibidos separadamente.
- Monitoramento de ausência de envio não representa isoladamente qualidade dos serviços.
- O token administrativo demonstra a exigência no backend, mas não substitui autenticação corporativa.
