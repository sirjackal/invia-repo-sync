const chokidar = require('chokidar');
const path = require('path');
const scpClient = require('scp2');
const fs = require('fs');
const git = require('simple-git');
const sshClient = require('ssh2').Client;
const notifier = require('node-notifier');
const readlineSync = require('readline-sync');

const SEVERITY_INFO = 'info';
const SEVERITY_WARNING = 'warning';
const SEVERITY_ERROR = 'error';

// TODO: determine default SSH keys path based on OS - process.platform === "win32"
const sshKeyPath = `${process.env['USERPROFILE']}\\.ssh\\id_rsa`;
const basePath = path.resolve(__dirname, '..');  // c:\Dev\invia

console.log('basePath:', basePath);
console.log('sshKeyPath:', sshKeyPath);

// TODO: try to connect to VM

const watchedDirs = [
   'web',
   'library/Invia/**'
];

for (dir of watchedDirs) {
    // take just 'library' from 'library/Invia/**'
    let repoPath = dir.replace(/^([^\\/]+).*$/, '$1');
    repoPath = path.resolve(basePath, repoPath);

    if (readlineSync.keyInYN(`Do you want to reset git repository '${repoPath}'?`)) {
        git(repoPath).reset('hard').pull();
        console.log(`Repository '${repoPath}': git reset --hard`);
    }
}

const sshOptions = {
    host: 'centos',
    username: 'invia',
    privateKey: fs.readFileSync(sshKeyPath)  // TODO: handle error if not exists
};

const getCurrentDirName = () => {
    const i = __dirname.lastIndexOf(path.sep);
    return __dirname.substr(i >= 0 ? i + 1 : 0);
};

const ignoredPaths = [getCurrentDirName() + '/*', '.git', 'node_modules', '.idea', 'dist', 'cache'];
const ignoredExtensions = ['png', 'jpg', 'gif', 'svg', 'ico'];

let watcherReady = false;

const watchOptions = {
    cwd: basePath,
    //ignored: [getCurrentDirName() + '/*', '**/.git/**', '**/node_modules/**', '**/*.{png,jpg,gif,svg,ico}', '**/.idea/**', '**/dist/**', '**/cache/**'],
    ignored: path => {
        for (const ignoredPath of ignoredPaths) {
            if (path.includes(`/${ignoredPath}/`)) {
                if (!watcherReady) {
                    console.log(`ignore ${path}`);
                }
                return true;
            }
        }

        for (const ignoredExtension of ignoredExtensions) {
            if (path.endsWith(`.${ignoredExtension}`)) {
                if (!watcherReady) {
                    console.log(`ignore ${path}`);
                }
                return true;
            }
        }

        return false;
    },
    followSymlinks: false
};

const watcher = chokidar.watch(watchedDirs, watchOptions);
watcher.on('ready', () => {
    watcherReady = true;
    const msg = 'Initial scan complete!';
    console.log(msg);
    notify(msg, SEVERITY_INFO);
});

watcher.on('all', (event, winRelPath) => {
    try {
        let winPath = path.resolve(basePath, winRelPath);
        console.log(event, winPath);

        if (!watcherReady) {
            return;
        }

        let linuxPath = `/var/invia/${winRelPath}`.replace(/\\/g, '/');

        // TODO: functions are async and some errors aren't caught
        switch (event) {
            case 'add':
            case 'change':
                scpCopy(winPath, linuxPath);
                break;

            case 'unlink':
            case 'unlinkDir':
                sshDelete(event, linuxPath);
                break;

            default:
                const msg = `Unsupported event '${event}'`;
                console.warn(msg);
                notify(msg, SEVERITY_WARNING);
                break;
        }
    }
    catch (err) {
        console.error(err);
        notify('Error: ' + err.toString(), SEVERITY_ERROR);
    }
});

const scpCopy = (winPath, linuxPath) => {
    scpClient.scp(winPath, {...sshOptions, path: linuxPath}, function(err) {
        if (err) {
            throw new Error(`File '${linuxPath}' copy error: + ${err}`);
        } else {
            const msg = `File '${linuxPath}' copied OK`;
            console.log(msg);
            notify(msg, SEVERITY_INFO);
        }
    });
}

const sshDelete = (event, linuxPath) => {
    let conn = new sshClient();
    conn.on('watcherReady', () => {
        conn.exec(`rm -rf ${linuxPath}`, function(err, stream) {
            if (err) {
                throw new Error(`File '${linuxPath}' delete error: ${err}`);
            }
            stream.on('close', function(code, signal) {
                const msg = `${event} '${linuxPath}'`;
                console.log(msg);
                notify(msg, SEVERITY_INFO);
                conn.end();
            }).on('data', function(data) {
                
            }).stderr.on('data', function(data) {
                throw new Error(`File '${linuxPath}' delete error: ${data}`);
            });
        });
    }).connect(sshOptions);
}

const notify = (msg, severity) => {
	severity = severity !== undefined ? severity : SEVERITY_INFO;

	const options = {
        title: 'invia-repo-sync',
        message: msg,
        icon: path.join(__dirname, 'invia-logo.png'),
        wait: false,
        //sound: 'ms-winsoundevent:Notification.Default',
        sound: severity !== SEVERITY_INFO,
    };

    notifier.notify(options);
 //    new notifier.NotificationCenter(options).notify();
	// new notifier.NotifySend(options).notify();
	// new notifier.WindowsToaster(options).notify(options);
	// new notifier.WindowsBalloon(options).notify(options);
	// new notifier.Growl(options).notify(options);
};
