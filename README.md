# SUS+ — protótipo acadêmico

## Implementação atual
- Interface responsiva com navegação entre Início, Área do cidadão, Área do gestor e Sobre/fontes.
- Carregamento do banco SQLite existente; os arquivos em `Base de Dados` não são importados automaticamente.
- Importação administrativa adicional de CSV, XLS e XLSX por token no servidor.
- Armazenamento em SQLite com metadados de categoria, fonte, arquivo, período e quantidade de registros.
- Busca textual sem distinção de maiúsculas/minúsculas e sem acentos.
- Filtros por campos existentes e combinação E (AND) ou OU (OR).
- Exibição de estabelecimentos CNES com coordenadas válidas vinculadas ao OpenStreetMap.
- Painel do gestor com cartões, gráficos de competência e tabelas de produção.
- Remoção de CNS e matrícula funcional dos dados importados e publicados.

## Dados importados e validados
- O banco local atual contém `9` conjuntos e `7759` registros.
- CNES: `7423` estabelecimentos únicos de Belo Horizonte; sem duplicidade de CNES detectada.
- SIAPS APS: `8` competências consolidadas em janeiro–agosto de 2026.
- SIAPS ACS: `8` competências consolidadas em janeiro–agosto de 2026; uma duplicidade exata foi removida.
- Monitoramento SIAPS: `170` registros nas abas Estabelecimentos (`2`), Equipes (`20`) e ACS (`148`); dados administrativos de AGO/2026.
- Profissionais e vínculos administrativos: `148` registros ACS de Belo Horizonte, com os campos selecionados pelo importador tratados.
- SIA/SUS: `1` registro municipal válido, quantidade aprovada `6886771` em Ago/2026. A linha “Total” não foi contabilizada.
- SISAB: `1` registro municipal válido de Belo Horizonte, com valores consolidados de produção em competências de JAN/2026 a SET/2026.

O SISAB contém 5582 linhas nacionais no relatório original, mas o protótipo importa apenas a linha municipal de Belo Horizonte. Os dados originais não são alterados.

## Estrutura dos arquivos
- CNES: CSV UTF-8 com cabeçalho na primeira linha e delimitador `;`.
- SIA/SUS: CSV CP1252 com títulos e metadados antes do cabeçalho. O cabeçalho real está na linha 5.
- SISAB: CSV CP1252 com metadados nas primeiras linhas. O cabeçalho real está na linha 8.
- Coberturas SIAPS: XLSX com uma aba `Dados` e cabeçalho na primeira linha.
- Monitoramento SIAPS: XLSX com três abas relevantes: `Estabelecimentos`, `Equipes` e `ACS`.
- Profissionais ACS: XLSX tratado; a rotina de importação seleciona apenas CBO e campos administrativos indicados no código.

## Como executar
Requer Node.js 18 ou superior.

1. Abra um terminal na raiz deste repositório.
2. Instale as dependências com `npm ci`.
3. Configure `ADMIN_TOKEN` e inicie com `npm start`.
4. Acesse `http://localhost:3000`.

O banco local padrão é `susmais.sqlite` nesta pasta. `SUSMAIS_DB_PATH` pode apontar para outro arquivo SQLite existente. A aplicação interrompe a inicialização se o arquivo não existir, estiver sem dados ou não tiver as tabelas esperadas; ela não cria nem semeia automaticamente um banco vazio.

`SUSMAIS_SETUP_MODE=true` permite iniciar a interface antes de o arquivo SQLite ser transferido. A página mostra o estado de preparação, as APIs de dados e a importação retornam HTTP 503 e nenhum banco é aberto ou criado. Desative com `SUSMAIS_SETUP_MODE=false` após copiar um banco válido para `SUSMAIS_DB_PATH`; fora do modo de preparação, arquivo ausente, inválido ou vazio continua impedindo a inicialização.

`UPLOAD_DIR` define onde os arquivos enviados são armazenados temporariamente. Por padrão, usa `uploads/` nesta pasta. Fora do modo de preparação, o servidor verifica a disponibilidade e a gravação no diretório pai antes de criar apenas a pasta final; não cria diretórios pais. Em modo de preparação, não verifica nem cria `UPLOAD_DIR`. Os arquivos temporários são removidos depois da importação.

Importações administrativas exigem `ADMIN_TOKEN` em qualquer ambiente. Sem a variável, a rota `/api/import` fica desativada; não há token padrão. Antes de uma importação, o servidor cria um backup do SQLite ao lado do banco. Garanta espaço e permissão de escrita nesse diretório.

### Render

- Root Directory: raiz do repositório conectado.
- Build Command: `npm ci`.
- Start Command: `npm start`.
- Configure `SUSMAIS_DB_PATH` para o caminho do banco disponibilizado no serviço, `UPLOAD_DIR` para uma pasta gravável e persistente se os uploads precisarem sobreviver a reinicializações, e `ADMIN_TOKEN` como segredo.
- Monte um disco persistente em `/var/data` e use `SUSMAIS_DB_PATH=/var/data/susmais.sqlite` e `UPLOAD_DIR=/var/data/uploads`.
- Faça primeiro o deploy com `SUSMAIS_SETUP_MODE=true`; a página e o health check sobem sem abrir ou criar um banco.
- Copie o banco local atual por canal privado para `/var/data/susmais.sqlite`. O Render documenta SCP/SFTP para serviços com SSH; o disco não está disponível nos comandos de build ou pre-deploy.
- Após a transferência, defina `SUSMAIS_SETUP_MODE=false` e reinicie/reimplante o serviço. O servidor valida tabelas e conteúdo antes de servir dados.
- O sistema de arquivos do serviço pode ser efêmero. Use o disco persistente do Render para o SQLite e backups; sem esse armazenamento, alterações podem ser perdidas em reinicializações e novos deploys.

### Arquivos-fonte usados para reconstruir os dados

Os arquivos abaixo ficam fora deste repositório e não são necessários quando o banco atual é disponibilizado. A rotina antiga de importação automática os procurava em `Base de Dados`:

- `CNES/estabelecimentos-310620.csv`
- `Secretária de Saúde Belo Horizonte/equipes-servicos-sujeitos-suspensao.xlsx`
- `SIAPS/cobertura-aps-13-11-2026.xlsx`
- `SIAPS/cobertura-acs-13-11-2026.xlsx`
- `SIA\SUS/sia_cnv_qamg150402191_244_164_157.csv`
- `SISAB/RelatorioSaudeProducao(3).csv`
- `Tratados/profissionais-acs-bh-ago-2026-tratado.xlsx`

Não publique esses arquivos-fonte sem revisar sua origem e conteúdo, em particular a planilha de profissionais. A pasta inteira `Base de Dados/` é ignorada pelo Git.

## Validações anteriores do protótipo
- Sintaxe dos arquivos JavaScript verificada com `node --check`.
- Importação automática dos seis arquivos reais validada pelo endpoint `/api/datasets`.
- Busca por bairro, nome, CNES e código municipal executada.
- Painel analítico carregado em `/api/dashboard`.
- Percentuais ACS, capacidades APS e tabelas SISAB/SIA/SUS carregados a partir dos dados reais.
- CNS não aparece nas consultas públicas.

## Limitações conhecidas
- Não há correspondência validada entre unidades da SMSA e estabelecimentos CNES além do código municipal.
- O arquivo APS contém capacidade por equipe, mas o campo `Cobertura APS` está vazio nas linhas originais; o protótipo não inventa valores.
- Cobertura APS e ACS são estimativas; não contam pessoas efetivamente atendidas.
- SISAB e SIA/SUS representam produções com conceitos diferentes e são exibidos separadamente.
- Monitoramento de ausência de envio não representa isoladamente qualidade dos serviços.
- O token administrativo protege a rota de importação, mas não substitui autenticação corporativa.
