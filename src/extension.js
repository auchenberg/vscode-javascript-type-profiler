const vscode = require('vscode');
const path = require('path');

const puppeteer = require('puppeteer');

let browser = null;
let page = null;

function activate(context) {
    const collection = vscode.languages.createDiagnosticCollection('javascript');

    const disposable = vscode.commands.registerCommand('extension.typeProfile', async () => {

        if (!browser) {
            browser = await puppeteer.launch();
            page = await browser.newPage();
        }

        await page.reload();
        // I haven't found an official way to send CDP commands directly via puppeteer, so I'm using
        // a private API here (remember it's a POC!)
        await page._client.send('Runtime.enable');
        await page._client.send('Profiler.enable');
        await page._client.send('Profiler.startTypeProfile');

        const document = vscode.window.activeTextEditor.document;
        const fileName = path.basename(document.uri.toString());

        // Compile script
        const { scriptId, exceptionDetails } = await page._client.send('Runtime.compileScript', {
            expression: document.getText(),
            sourceURL: fileName,
            persistScript: true
        });

        if (exceptionDetails) {
            // Exception lineNumber and columnNumber can be used to highlight offending code.
            vscode.window.showErrorMessage(`Error compiling script: ${exceptionDetails.text} ${exceptionDetails.lineNumber}:${exceptionDetails.columnNumber}`);
            return;
        }

        // Execute script
        await page._client.send('Runtime.runScript', { scriptId });

        const { result } = await page._client.send('Profiler.takeTypeProfile');
        const script = result.find(script => script.url === fileName);

        if (script) {
            const document = vscode.window.activeTextEditor.document;

            const diagnostics = script.entries.map(entry => {
                // I'm highlighting only 1 character, it'd be better to highlight whole symbol
                const typePositionStart = document.positionAt(entry.offset);
                const typePositionEnd = new vscode.Position(typePositionStart.line, typePositionStart.character + 1);
                const range = new vscode.Range(typePositionStart, typePositionEnd);

                const typesString = entry.types.map(type => type.name).join(' or ');

                return new vscode.Diagnostic(range, `V8 says it's a ${typesString}`, vscode.DiagnosticSeverity.Information);
            });

            collection.set(document.uri, diagnostics);
        }

        await page._client.send('Profiler.stopTypeProfile');
        await page._client.send('Profiler.disable');
        await page._client.send('Runtime.disable');
    });

    context.subscriptions.push(disposable);
}
exports.activate = activate;

async function deactivate() {
    if (browser) {
        await browser.close();
    }
}
exports.deactivate = deactivate;