const chokidar = require('chokidar');
const path = require('path');
const scpClient = require('scp2');
const fs = require('fs');
const git = require('simple-git');
var sshClient = require('ssh2').Client;

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
    git(repoPath).reset('hard');
}

const sshOptions = {
    host: 'centos',
    username: 'invia',
    privateKey: fs.readFileSync(sshKeyPath)
};

const watchOptions = {
    cwd: basePath,
    ignored: ['watcher/*', '**/node_modules/**', '**/*.{png,jpg,gif,svg,ico}'],
    followSymlinks: false
};

let ready = false;
const watcher = chokidar.watch(watchedDirs, watchOptions);
watcher.on('ready', () => {
    console.log('Initial scan complete!');
    ready = true;
});

watcher.on('all', (event, winRelPath) => {
    try {
        let winPath = path.resolve(basePath, winRelPath);
        let linuxPath = `/var/invia/${winRelPath}`.replace(/\\/g, '/');

        if (!ready) {
            console.log(event, winPath);
            return;
        }

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
                console.warn(`Unsupported event '${event}'`);
                break;
        }
    }
    catch (err) {
        console.error(err);
    }
});

const scpCopy = (winPath, linuxPath) => {
    scpClient.scp(winPath, {...sshOptions, path: linuxPath}, function(err) {
        if (err) {
            throw new Error(`File ${linuxPath} copy error: + ${err}`);
        } else {
            console.log(`File ${linuxPath} copied OK`);
        }
    });
}

const sshDelete = (event, linuxPath) => {
    let conn = new sshClient();
    conn.on('ready', () => {
        conn.exec(`rm -rf ${linuxPath}`, function(err, stream) {
            if (err) {
                throw new Error(`File ${linuxPath} delete error: ${err}`);
            }
            stream.on('close', function(code, signal) {
                console.log(`${event} ${linuxPath}`);
                conn.end();
            }).on('data', function(data) {
                
            }).stderr.on('data', function(data) {
                throw new Error(`File ${linuxPath} delete error: ${data}`);
            });
        });
    }).connect(sshOptions);
}
