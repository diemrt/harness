---
id: bfb0a23f-50ff-4e44-873e-585b1bcedbd8
title: Il verificatore non spunta i validation.tasks, e l'agent non sa di doverlo
status: done
tier: standard
depends_on: []
covers: [97b8668]
tasks:
  -
    id: 1
    short_title: Il punto di procedura sui validation.tasks
    full_description: "In agents/harness-verifier.md, dentro la Procedura, il dovere di spuntare i validation.tasks diventa un passo numerato accanto a 'confronta i criteri' e 'esegui il gate'. Oggi la parola compare solo nel ramo di fallimento ('non spuntare nessun validation.tasks' quando nessuna shell parte): il divieto c'e', il dovere no. Il passo dice: spuntare quelli verificati davvero, lasciare non spuntati gli altri, mai spuntarli tutti per chiudere."
    checked: true
  -
    id: 2
    short_title: Il payload d'esempio include i validation.tasks
    full_description: "Il punto 5 mostra {status, validation:{criteria, state}}, che per contratto della CLI conserva i tasks invariati: l'esempio insegna proprio l'omissione. Va reso esplicito che per spuntarli l'array va rispedito per intero con checked aggiornato, come gia' dice references/verification.md riga 82-83."
    checked: true
  -
    id: 3
    short_title: Il test che difende la prescrizione
    full_description: "In test/plugin-agent.test.mjs un test asserisce che l'agent nomina validation.tasks nella procedura e che il payload d'esempio li include. Ancorato alla frase e non alla parola nuda, come gia' fanno i test vicini: /validation\\.tasks/ da solo passerebbe con la sola riga del ramo di fallimento, che e' esattamente lo stato di partenza da cui il test deve proteggere."
    checked: true
  -
    id: 4
    short_title: Suite verde
    full_description: "npm test verde: e' il gate dichiarato in .harness/config.json."
    checked: true
  -
    id: 5
    short_title: La storia non viene ritoccata
    full_description: "Controllare col diff di issues.json che i validation.tasks di e6836699 e b2c59231 restino a checked:false. Spuntarli adesso fabbricherebbe evidenza di una verifica che nessuno ha fatto."
    checked: true
  -
    id: 6
    short_title: Commit e consegna a in_review
    full_description: "Commit sul ramo, poi status in_review con validation.state unknown. La chiusura spetta a harness-verifier: niente push prima del pass. Commit: 97b8668."
    checked: true
validation:
  criteria: "npm test: 425 pass, 0 fail (`npm run test`, gate dichiarato in .harness/config.json). agents/harness-verifier.md righe 100-111 (Procedura punto 3): 'Spunta i validation.tasks man mano che li verifichi... Spunti quelli che hai verificato davvero, e lasci non spuntati gli altri... Non spuntarli tutti per chiudere'. Payload al punto 6 (righe 128-129) include 'tasks':[...] in entrambi i rami pass/fail, con nota a riga 131 che l'array va rispedito per intero. Test in test/plugin-agent.test.mjs verificati contro git show 97b8668^:agents/harness-verifier.md tramite probe in directory temporanea: sul file precedente i regex delle asserzioni (tick-duty, leave-unticked, no-tick-all, payload con tasks, rispedito-per-intero) non trovano match, sul file nuovo tutti trovano match - i test sono ancorati alla prescrizione, non alla parola nuda. git diff 97b8668^ 97b8668 -- issues.json tocca solo il blocco della issue bfb0a23f (nessuna riga id aggiunta/rimossa per altre issue). validation.tasks di e6836699-8a91-40c2-9db5-ed544f9eb7fc e b2c59231-709d-469a-8746-1d0b290ee427 restano [false,false,false,false,false] (verificato con --get). Nessun riferimento orfano a 'punto 5'/numerazione vecchia della procedura trovato altrove nel plugin (grep su tutto il repo). git status --short mostra solo issues.json non committato (transizione backlog->in_progress->in_review con covers:[97b8668], normale passaggio pre-chiusura), nessun altro file toccato fuori scope."
  tasks:
    -
      id: 1
      short_title: L'agent impara il dovere
      full_description: "agents/harness-verifier.md nomina validation.tasks nella procedura: spuntare quelli verificati davvero, lasciare non spuntati gli altri, e mai spuntarli tutti per chiudere."
      checked: true
    -
      id: 2
      short_title: Il payload d'esempio smette di cementare l'omissione
      full_description: "L'esempio di chiusura al punto 5 include validation.tasks. Oggi mostra {criteria, state}, che per contratto della CLI li conserva invariati: l'esempio insegna a non farlo."
      checked: true
    -
      id: 3
      short_title: Un test difende la prescrizione
      full_description: Un test asserisce che agents/harness-verifier.md nomina validation.tasks e che il payload d'esempio li include. Senza, la riga puo' essere tolta da una riscrittura e nessuno se ne accorge - che e' esattamente come ci siamo arrivati.
      checked: true
    -
      id: 4
      short_title: Suite verde
      full_description: npm test verde, che e' anche il gate di .harness/config.json.
      checked: true
    -
      id: 5
      short_title: La storia non viene ritoccata
      full_description: I validation.tasks delle due issue gia' chiuse restano non spuntati. Spuntarli adesso significherebbe fabbricare evidenza di una verifica che nessuno ha fatto, che e' un difetto peggiore di quello che stiamo correggendo.
      checked: true
  state: pass
created_at: "2026-08-13T10:17:45Z"
updated_at: "2026-08-14T09:10:45Z"
---

# Il verificatore non spunta i validation.tasks, e l'agent non sa di doverlo

Due issue chiuse su due (e6836699 e b2c59231) hanno tutti i validation.tasks a checked:false dopo il pass. Non e' la dimenticanza di un giro: e' sistematico, e la causa e' localizzata.

Il dovere esiste in references/verification.md, che assegna al verificatore "eseguire il gate, spuntare i validation.tasks, chiudere la issue" (riga 12) e lo ripete al punto 2 di riga 29. Ma agents/harness-verifier.md non nomina validation.tasks nemmeno una volta, e il payload di chiusura che mostra al punto 5 e' {status, validation:{criteria, state}} - che per contratto della CLI li conserva invariati. L'agent non impara il dovere, e l'esempio che segue lo cementa.

E' il difetto che issues.md ha gia' nominato altrove: una regola scritta solo dove la legge l'orchestratore e' invisibile al lettore piu' frequente, che e' l'agent.

Il danno e' silenzioso. La issue si chiude done/pass, le caselle non spuntate sembrano normali, e chi rilegge non distingue "il verificatore non ha guardato" da "ha guardato e non era soddisfatto": la checklist del giudizio e' dato morto che sembra vivo.
