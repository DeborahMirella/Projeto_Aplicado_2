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

O backend local padrão usa `@libsql/client` sobre o arquivo SQLite existente `susmais.sqlite`. `DB_BACKEND=sqlite` e `SUSMAIS_DB_PATH` selecionam o arquivo local. A aplicação interrompe a inicialização se o arquivo não existir, estiver vazio ou não tiver o esquema esperado; não cria um banco vazio.

`DB_BACKEND=turso` seleciona o banco remoto e exige `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN`. A inicialização valida tabelas, metadados e contagens; credenciais ausentes, schema incompatível ou banco vazio impedem a aplicação de servir as rotas de dados. `SUSMAIS_SETUP_MODE=true` continua permitindo iniciar apenas a interface de preparação, sem conectar ou validar o banco; nesse modo as APIs dependentes de dados retornam HTTP 503.

`UPLOAD_DIR` define onde os arquivos enviados são armazenados temporariamente. Os arquivos são removidos após a importação. Em modo de preparação, o servidor não acessa esse caminho.

Importações administrativas exigem `ADMIN_TOKEN` em qualquer ambiente e são transacionais. Antes de cada importação é criado um backup local protegido por permissões de arquivo. `IMPORT_BACKUP_DIR` pode definir a pasta; por padrão é usada uma pasta temporária do sistema.

### Render

- Root Directory: raiz do repositório conectado.
- Build Command: `npm ci`.
- Start Command: `npm start`.
- Configure `DB_BACKEND=turso`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` e `ADMIN_TOKEN` no painel do Render. Não coloque tokens no repositório.
- Para o primeiro início sem banco configurado, use `SUSMAIS_SETUP_MODE=true`; após criar o destino e migrar os dados, desative a variável e reinicie.
- O plano gratuito do Render tem sistema de arquivos efêmero. Backups exportados para `IMPORT_BACKUP_DIR` no serviço não sobrevivem a reinicializações; mantenha cópias em armazenamento privado durável.

### Turso: criar, migrar e validar

Instale o CLI Turso, autentique e crie uma base libSQL vazia. Não use `--from-file` junto com a rotina abaixo: a rotina cria o esquema e verifica os dados por conta própria.

```sh
turso auth login
turso db create susmais
turso db show susmais
turso db tokens create susmais
```

Configure `DB_BACKEND=turso`, `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` localmente sem salvar o token no Git. Faça uma cópia privada do SQLite original e migre essa cópia:

```sh
DB_BACKEND=turso TURSO_DATABASE_URL='libsql://…' TURSO_AUTH_TOKEN='…' \
  npm run migrate:turso -- /caminho/privado/susmais.sqlite
```

A rotina lê a origem em modo somente leitura, exige 9 conjuntos e 7.759 registros, preserva IDs e metadados, insere em uma transação e compara hashes. Se for executada novamente, só aceita um destino vazio ou uma cópia já idêntica; destinos parciais ou divergentes são recusados.

Para comparar o banco e as APIs, inicie duas instâncias em terminais separados, uma com a origem SQLite e outra com o destino Turso:

```sh
DB_BACKEND=sqlite SUSMAIS_DB_PATH=/caminho/privado/susmais.sqlite PORT=3000 npm start
DB_BACKEND=turso TURSO_DATABASE_URL='libsql://…' TURSO_AUTH_TOKEN='…' PORT=3001 npm start
```

Em outro terminal, rode:

```sh
SUSMAIS_DB_PATH=/caminho/privado/susmais.sqlite \
TURSO_DATABASE_URL='libsql://…' TURSO_AUTH_TOKEN='…' \
LOCAL_API_URL=http://127.0.0.1:3000 REMOTE_API_URL=http://127.0.0.1:3001 \
  npm run verify:turso
```

O verificador compara contagens, IDs, relações, hashes, integridade e respostas de `/api/datasets`, `/api/search`, `/api/dashboard` e `/api/citizen/units`. Os arquivos originais em `Base de Dados/` não são reimportados.

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
