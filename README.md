# 📘 Documentation du module goblin-wm

## Aperçu

Le module `goblin-wm` (Window Manager) est un gestionnaire de fenêtres Electron pour le framework Xcraft. Il fournit une interface complète pour créer, gérer et contrôler les fenêtres de l'application, en gérant à la fois les communications IPC et WebSocket avec les clients. Ce module sert de pont entre l'interface utilisateur React et le backend Xcraft, orchestrant les interactions entre les différents composants de l'écosystème.

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Configuration avancée](#configuration-avancée)
- [Détails des sources](#détails-des-sources)

## Structure du module

Le module `goblin-wm` est organisé autour d'un acteur Goblin principal qui gère :

- **Création et gestion des fenêtres Electron** : Configuration, positionnement, état
- **Communication bidirectionnelle** : IPC et WebSocket selon les besoins
- **Gestion des feeds** : Synchronisation des données avec le warehouse
- **Raccourcis clavier** : Enregistrement et gestion des shortcuts locaux
- **Intégration système** : Tray, dock, taskbar selon la plateforme

## Fonctionnement global

Le gestionnaire de fenêtres fonctionne selon ce flux principal :

1. **Création d'une fenêtre** : L'acteur `wm` est instancié avec les paramètres de fenêtre
2. **Établissement de la communication** : Choix entre IPC (par défaut) ou WebSocket
3. **Synchronisation des données** : Abonnement aux feeds du warehouse pour les mises à jour d'état
4. **Gestion des événements** : Traitement des interactions utilisateur et des commandes système
5. **Cycle de vie** : Gestion de la fermeture et du nettoyage des ressources

Le module utilise le pattern Redux pour la gestion d'état et s'intègre parfaitement avec l'écosystème Xcraft via le bus de commandes.

### Gestion des sessions et partitions

Le module supporte la gestion avancée des sessions Electron, permettant l'utilisation de partitions personnalisées pour isoler les données de session. Le système remplace dynamiquement les variables comme `$PROCESS_PID` dans les noms de partition pour permettre l'isolation par processus.

### Communication multi-canal

Deux modes de communication sont supportés :

- **Mode IPC** (par défaut) : Communication directe via les canaux IPC d'Electron
- **Mode WebSocket** : Serveur WebSocket intégré pour les communications réseau

## Exemples d'utilisation

### Création d'une fenêtre basique

```javascript
// Création d'une fenêtre pour un desktop
await this.quest.create('wm', {
  id: `wm@${desktopId}`,
  desktopId,
  labId: 'laboratory@123',
  feeds: [desktopId, 'client-session@user'],
  clientSessionId: 'client-session@user',
  userId: 'user@domain',
  url: 'http://localhost:3000',
  options: {
    width: 1200,
    height: 800,
    frame: false,
  },
});
```

### Navigation et dispatch d'actions

```javascript
// Navigation vers une nouvelle route
await this.quest.cmd('wm.nav', {
  id: `wm@${desktopId}`,
  route: '/dashboard',
});

// Dispatch d'une action Redux
await this.quest.cmd('wm.dispatch', {
  id: `wm@${desktopId}`,
  action: {
    type: 'UPDATE_USER_PREFERENCES',
    payload: {theme: 'dark'},
  },
});
```

### Gestion des raccourcis clavier

```javascript
// Ajout de raccourcis
await this.quest.cmd('wm.add-shortcuts', {
  id: `wm@${desktopId}`,
  shortcuts: [
    {
      keys: 'Ctrl+N',
      action: 'new-document-requested',
    },
    {
      keys: 'Ctrl+S',
      action: {
        goblinId: 'document@123',
        questName: 'save',
        args: {},
      },
    },
  ],
});
```

### Gestion des boîtes de dialogue

```javascript
// Sélection de fichiers
const filePaths = await this.quest.cmd('wm.select-file-paths', {
  id: `wm@${desktopId}`,
  title: 'Sélectionner des documents',
  defaultPath: '/home/user/documents',
  fileFilter: [{name: 'Documents', extensions: ['pdf', 'doc', 'docx']}],
  directory: false,
  multi: true,
});

// Boîte de message
const response = await this.quest.cmd('wm.messageBox', {
  id: `wm@${desktopId}`,
  title: 'Confirmation',
  type: 'question',
  message: 'Voulez-vous sauvegarder les modifications ?',
  buttons: ['Oui', 'Non', 'Annuler'],
  defaultId: 0,
  cancelId: 2,
});
```

### Utilisation avec des cookies et sessions personnalisées

```javascript
// Création d'une fenêtre avec cookies et session personnalisée
await this.quest.create('wm', {
  id: `wm@${desktopId}`,
  desktopId,
  labId: 'laboratory@123',
  feeds: [desktopId],
  clientSessionId: 'client-session@user',
  userId: 'user@domain',
  url: 'https://app.example.com',
  options: {
    webPreferences: {
      partition: 'persist:user-$PROCESS_PID',
    },
  },
  cookies: [
    {
      url: 'https://app.example.com',
      name: 'sessionToken',
      value: 'abc123',
    },
  ],
});
```

## Interactions avec d'autres modules

Le module `goblin-wm` interagit étroitement avec :

- **[xcraft-core-host]** : Utilise le WM pour la gestion native des fenêtres
- **[goblin-laboratory]** : Fournit les canaux de communication (WebSocket/Electron)
- **[goblin-warehouse]** : Synchronisation des données et gestion des feeds
- **[goblin-desktop]** : Gestion des onglets et de l'interface utilisateur
- **[xcraft-core-etc]** : Chargement de la configuration du module
- **[xcraft-core-transport]** : Gestion des transferts de données et streaming
- **[xcraft-core-busclient]** : Communication avec le bus Xcraft global
- **[xcraft-core-shredder]** : Manipulation des structures de données immutables

## Configuration avancée

| Option                | Description                                     | Type    | Valeur par défaut |
| --------------------- | ----------------------------------------------- | ------- | ----------------- |
| `windowOptions`       | Options pour la BrowserWindow Electron          | Object  | `null`            |
| `splashWindowOptions` | Options pour l'écran de démarrage               | Object  | `null`            |
| `vibrancyOptions`     | Options de transparence/vibrancy                | Object  | `null`            |
| `titlebar`            | Nom du widget de barre de titre                 | String  | `null`            |
| `disableSplash`       | Désactiver l'écran de démarrage                 | Boolean | `false`           |
| `splashDelay`         | Délai après l'apparition de la première fenêtre | Number  | `1000`            |
| `closable`            | Permettre la fermeture de la fenêtre            | Boolean | `true`            |

## Détails des sources

### `lib/service.js`

Ce fichier contient l'acteur Goblin principal qui orchestre toute la gestion des fenêtres. Il expose de nombreuses quêtes pour contrôler les fenêtres et gérer leur cycle de vie.

#### État et modèle de données

L'état de l'acteur contient :

- `id` : Identifiant unique de l'instance de fenêtre
- Variables internes stockées via `setX()` : instance de fenêtre, canaux de communication, abonnements

#### Méthodes publiques

- **`create(desktopId, labId, feeds, clientSessionId, userId, url, urlOptions, options, cookies)`** — Crée une nouvelle fenêtre avec tous les paramètres de configuration. Établit la communication IPC ou WebSocket et configure les abonnements aux feeds.
- **`setUserId(userId)`** — Met à jour l'identifiant utilisateur pour la session courante.
- **`visitURL(url, endOfVisitUrl, urlOptions, cookies)`** — Navigue temporairement vers une URL externe et revient automatiquement à l'URL principale quand l'URL de fin est atteinte.
- **`get-titlebar()`** — Retourne les informations de configuration de la barre de titre si la fenêtre est sans frame.
- **`set-titlebar(title)`** — Définit le titre de la fenêtre.
- **`begin-render()`** — Démarre le processus de rendu en synchronisant les données et en notifiant le client.
- **`resendState()`** — Renvoie l'état complet au client en cas de reconnexion.
- **`feed-sub(desktopId, feeds)`** — Gère les abonnements aux feeds du warehouse pour la synchronisation des données.
- **`nav(route)`** — Navigue vers une nouvelle route côté client.
- **`dispatch(action)`** — Envoie une action Redux au client.
- **`move-to-front()`** — Amène la fenêtre au premier plan.
- **`getNativeWindowHandle()`** — Retourne le handle natif de la fenêtre pour l'intégration système.
- **`flashFrame()`** — Fait clignoter la fenêtre pour attirer l'attention.
- **`attachDock()` / `detachDock()`** — Gère l'affichage/masquage du dock sur macOS.
- **`setAppDetails(options)`** — Configure les détails de l'application pour la taskbar Windows.
- **`setTray(title, tooltip, iconPath, menu)`** — Crée une icône dans la zone de notification système.
- **`removeTray()`** — Supprime l'icône de la zone de notification.
- **`trayExists()`** — Vérifie si une icône de tray existe pour cette fenêtre.
- **`tryAdaptTaskbarToMonolithEnvironment(appUserModelID, appDisplayName, unpinnable)`** — Adapte l'affichage dans la taskbar pour les environnements monolithiques.
- **`get-file-path(defaultPath, fileFilter)`** — Ouvre une boîte de dialogue de sauvegarde de fichier.
- **`select-file-paths(title, defaultPath, fileFilter, directory, multi)`** — Ouvre une boîte de dialogue de sélection de fichiers.
- **`messageBox(title, type, message, buttons, defaultId, cancelId)`** — Affiche une boîte de dialogue de message.
- **`capture-page(parameters)`** — Capture une image de la page web.
- **`print-to-pdf(parameters)`** — Génère un PDF de la page web.
- **`get-window()` / `set-window(window)`** — Obtient ou définit les dimensions et position de la fenêtre.
- **`unsafe-get-window-instance()`** — Retourne l'instance native de la fenêtre (fonction dépréciée et non sécurisée).
- **`set-on-close(onCloseEvt)`** — Définit un événement personnalisé à émettre lors de la fermeture.
- **`close-window(clientSessionId, window, currentUrl)`** — Ferme la fenêtre et émet l'événement approprié.
- **`center-window()`** — Centre la fenêtre sur l'écran.
- **`hide-window()` / `maximize-window()` / `minimize-window()`** — Contrôle la visibilité et l'état de la fenêtre.
- **`window-is-visible()`** — Vérifie si la fenêtre est visible.
- **`add-shortcuts(shortcuts)` / `remove-shortcuts(shortcuts)` / `remove-all-shortcuts()`** — Gestion des raccourcis clavier locaux.
- **`delete()`** — Nettoie toutes les ressources et ferme la fenêtre.

### `lib/helpers.js`

Fournit des fonctions utilitaires pour la gestion des sessions Electron.

- **`getWindowSession()`** — Retourne la session Electron appropriée, soit personnalisée (basée sur une partition) soit la session par défaut. Supporte le remplacement dynamique du PID dans les noms de partition pour permettre l'isolation par processus.

### `wm.js`

Point d'entrée du module qui expose les commandes Xcraft via `xcraftCommands`.

---

_Ce document a été mis à jour pour refléter l'état actuel du code source._

[xcraft-core-host]: https://github.com/Xcraft-Inc/xcraft-core-host
[goblin-laboratory]: https://github.com/Xcraft-Inc/goblin-laboratory
[goblin-warehouse]: https://github.com/Xcraft-Inc/goblin-warehouse
[goblin-desktop]: https://github.com/Xcraft-Inc/goblin-desktop
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-transport]: https://github.com/Xcraft-Inc/xcraft-core-transport
[xcraft-core-busclient]: https://github.com/Xcraft-Inc/xcraft-core-busclient
[xcraft-core-shredder]: https://github.com/Xcraft-Inc/xcraft-core-shredder