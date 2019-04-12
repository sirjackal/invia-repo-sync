const chokidar = require('chokidar');
const path = require('path');
const scpClient = require('scp2');
const fs = require('fs');
const git = require('simple-git');
const sshClient = require('ssh2').Client;
const notifier = require('node-notifier');

const getCurrentDirName = () => {
    const i = __dirname.lastIndexOf(path.sep);
    return __dirname.substr(i >= 0 ? i + 1 : i);
};

// TODO: determine path based on OS - process.platform === "win32"
const sshKeyPath = `${process.env['USERPROFILE']}\\.ssh\\id_rsa`;
const basePath = path.resolve(__dirname, '..');  // c:\Dev\invia

console.log('basePath', basePath);
console.log('sshKeyPath', sshKeyPath);

const watchedDirs = [
   'web',
   //'library/Invia/**'
];

for (dir of watchedDirs) {
    // take just 'library' from 'library/Invia/**'
    let repoPath = dir.replace(/^([^\\/]+).*$/, '$1');
    repoPath = path.resolve(basePath, repoPath);
    console.log(`Repository ${repoPath}: git reset --hard`);
    // TODO: add user prompt
    git(repoPath).reset('hard');
}

const sshOptions = {
    host: 'centos',
    username: 'invia',
    privateKey: fs.readFileSync(sshKeyPath)  // TODO: handle error if not exists
};

const watchOptions = {
    cwd: basePath,
    ignored: [getCurrentDirName() + '/*', '**/node_modules/**', '**/*.{png,jpg,gif,svg,ico}'],
    followSymlinks: false
};

let ready = false;
const watcher = chokidar.watch(watchedDirs, watchOptions);
watcher.on('ready', () => {
    ready = true;
    const msg = 'Initial scan complete!';
    console.log(msg);
    notify(msg);
});

watcher.on('all', (event, winRelPath) => {
    try {
        let winPath = path.resolve(basePath, winRelPath);
        
        if (!ready) {
            console.log(event, winPath);
            return;
        }

        let linuxPath = `/var/invia/${winRelPath}`.replace(/\\/g, '/');

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
                notify(msg);
                break;
        }
    }
    catch (err) {
        console.error(err);
        notify('Error: ' + err.toString());
    }
});

const scpCopy = (winPath, linuxPath) => {
    scpClient.scp(winPath, {...sshOptions, path: linuxPath}, function(err) {
        if (err) {
            throw new Error(`File '${linuxPath}' copy error: + ${err}`);
        } else {
            const msg = `File '${linuxPath}' copied OK`;
            console.log(msg);
            notify(msg);
        }
    });
}

const sshDelete = (event, linuxPath) => {
    let conn = new sshClient();
    conn.on('ready', () => {
        conn.exec(`rm -rf ${linuxPath}`, function(err, stream) {
            if (err) {
                throw new Error(`File '${linuxPath}' delete error: ${err}`);
            }
            stream.on('close', function(code, signal) {
                const msg = `${event} '${linuxPath}'`;
                console.log(msg);
                notify(msg);
                conn.end();
            }).on('data', function(data) {
                
            }).stderr.on('data', function(data) {
                throw new Error(`File '${linuxPath}' delete error: ${data}`);
            });
        });
    }).connect(sshOptions);
}

const notify = (msg) => {
    notifier.notify({
        title: 'invia-repo-sync',
        message: msg,
        icon: path.join(__dirname, 'invia-logo.png'),
        wait: false
    });
};
