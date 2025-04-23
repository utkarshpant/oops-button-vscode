// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import OpenAI from 'openai';
import { getGreetingByTimeOfDay } from './utils/utils';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import { exec } from 'child_process';

const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

/**
 * ```const codeCells: {
    code: string;
    index: number;
    executionOrder: number;
}[]```
 */
const codeCellSchema = z.object({
	code: z.string(),
	index: z.number(),
	executionOrder: z.number().optional(),
});

const lastExecutedCellSchema = codeCellSchema.omit({
	executionOrder: true,
});

/**
 * Response schema: the response from the OpenAI API
 * should an object with either (but never both):
 * 1. an object with a `cellsToReRun` property: an array of indexes of code cells to re-run, OR
 * 2. an object with a `codeToRun` property: a single code cell to undo the last executed cell
 */
const responseSchema = z.object({
	cellsToReRun: z.array(z.number()).nullable().optional(),
	codeToRun: z.string().nullable().optional(),
});

/**
 *
 * This method is called when your extension is activated, which happens the very first time the command is executed
 */
export async function activate(context: vscode.ExtensionContext) {
	// check for API key
	const secret = await context.secrets.get('OOPS_OPENAI_API_KEY');
	if (!secret) {
		const apiKey = await vscode.window.showInputBox({
			prompt: 'Please enter your OpenAI API key',
			placeHolder: 'sk-proj-...',
			password: true,
			title: 'The Oops! Button needs your OpenAI API key',
		});
		if (apiKey) {
			await context.secrets.store('OOPS_OPENAI_API_KEY', apiKey);
			vscode.window.showInformationMessage("Thanks - we'll keep your API key safe.");
		} else {
			vscode.window.showErrorMessage('An OpenAI API key is required to use this extension.');
		}
	}

	/**
	 * This command is called when the user clicks the "Oops!" button in the notebook toolbar.
	 * This is the startup experience.
	 */
	vscode.window.showInformationMessage(
		`${getGreetingByTimeOfDay()} As a reminder - if you run the wrong cell, and make a mistake hit Ctrl+Shift+; to fix what you did!`
	);

	const disposable = vscode.commands.registerCommand('oops-button.undo', async () => {
		return vscode.window.withProgress(
			{
				title: 'Undoing the oopsie...',
				location: vscode.ProgressLocation.Notification,
				cancellable: false,
			},
			async (progress) => {
				/**
				 * Get the executed code cells, sorted in the order of execution.
				 */
				const executedCodeCells = vscode.window.activeNotebookEditor?.notebook
					.getCells()
					.filter(
						(cell) =>
							cell.kind === vscode.NotebookCellKind.Code &&
							cell.executionSummary?.timing?.endTime
					);
				if (executedCodeCells) {
					// some code was executed - collect all code up to the last executed cell, and pass it to the llm to undo.
					const lastExecutedCell = executedCodeCells.sort(
						(a, b) =>
							(b.executionSummary?.timing?.endTime || 0) -
							(a.executionSummary?.timing?.endTime || 0)
					)[0];

					const editor = vscode.window.activeNotebookEditor;
					if (editor) {
						const codeCells = editor.notebook
							.getCells()
							.filter(
								(cell) =>
									cell.kind === vscode.NotebookCellKind.Code &&
									cell.executionSummary?.success === true
							)
							.map((cell) => ({
								code: cell.document.getText(),
								index: cell.index,
								executionOrder: cell.executionSummary?.executionOrder ?? -1,
							}));

						// prepare context for the llm
						const codeContext = {
							allExecutedCodeCells: codeCells,
							lastExecutedCell: {
								code: lastExecutedCell.document.getText(),
								index: lastExecutedCell.index,
							},
						};
						// 		const prompt = `You are a Python code assistant specially suited for Jupyter notebooks. You will be given an array of code cells that have been written in a Jupyter Notebook, in the following format:
						// {
						// 	"allExecutedCodeCells": Array<{
						// 		"code": string, // the code in the cell
						// 		"index": number, // the index of the cell in the notebook
						// 		"executionOrder": number // the order in which the cell was executed -1 if not executed
						// 	}>
						// }
						// You will also be given the last executed cell, in the following format:
						// {
						// 	"lastExecutedCell": {
						// 		"code": string,
						// 		"index": number
						// 	}
						// }

						// ---

						// The user has asked for your assistance because the last executed cell has mutated the state of the variables in memory, and will be time-consuming to undo. Your task is to understand the code executed so far, construct a model of the state of the notebook, and finally, how the last executed cell has changed the state of the notebook. Then, you need to define a code cell that will restore the state of the notebook and the variables/data frames to their state _just prior_ to the execution of the last code cell - effectively the same as if the last code cell was never executed.

						// Your response guidelines are as follows:
						// 1. Start the code cell with a docstring explaining that this code undoes the last executed cell, and if required, briefly explain how/why it does what it does.

						// 2. The code should be valid Python code that can be executed in the notebook.

						// 3. The code should not contain any print statements or any other output.

						// 4. Comments to explain a line of code are allowed, but no other text is allowed.

						// 5. The code should NOT contain any code that is not necessary to undo the last executed cell.

						// 6. The code SHOULD NOT contain any imports, but you may use imports that are already in the notebook.

						// 7. If undoing the last executed cell's mutation is not trivial and the user MUST re-run some cells, please determine how many cells to backtrack and re-run, and just write that code in one cell for ease of execution. Skip cells that do not mutate data (e.g. plots, print statements, etc.). Again - the result of the code you write should be restoring everything the way it was before the last executed cell. DO NOT re-write code from the last executed cell!

						// 8. Be VERY careful with escape characters in the code and make sure you don't break the code.

						// 9. DO NOT WRAP THE CODE IN BACKTICKS - your response will be consumed directly, and WILL NOT BE in a Markdown cell.

						// 10. IF UNDO IS POSSIBLE AND YOU CAN GENERATE CODE, MAKE SURE THAT YOUR RESPONSE IS NOT JUST A DOCSTRING - PLEASE DON'T FORGET TO WRITE THE CODE!
						// ---

						// Examples:

						// 1. The user defined a DataFrame with 10,000 rows sourced from a CSV file, and then executed a cell that filtered the DataFrame to only include rows where the value in column A is greater than 10, and squared the filtered values. Your response should undo the filtering and squaring of the values, and restore the original DataFrame.

						// 2. The user mutated the column names of a database, replacing "_" with "__a", and ran it twice, resulting in columns with "__a__aa". Your response should undo the mutation and restore the original column names.

						// 3. The user generated a list comprehension using \`[i for i in range(1000)]\` and then squared the values in the list. The user then RAN THE SAME CELL AGAIN ACCIDENTALLY, squaring the values again. Your response should undo the second squaring of numbers, and restore the list of squares before the accidental cell execution.

						// 4. The user binarized a DataFrame column using a threshold, and wants to undo this change. Since the original data MUST be imported again, your response should re-import the data and do all the transformations again, UNTIL the binarization step.
						// `;
						const prompt = `You are a Python code assistant specially suited for Jupyter notebooks. You will be given an array of code cells that have been written in a Jupyter Notebook, in the following format:
				{
					"allExecutedCodeCells": Array<{
						"code": string, // the code in the cell
						"index": number, // the index of the cell in the notebook
						"executionOrder": number // the order in which the cell was executed -1 if not executed
					}>
				}
				You will also be given the last executed cell, in the following format:
				{
					"lastExecutedCell": {
						"code": string,
						"index": number
					}
				}

				---
				
				The user has asked for your assistance because the last executed cell has mutated the state of the variables in memory, and will be time-consuming to undo. Your task is to understand the code executed so far, construct a model of the state of the notebook, and finally, how the last executed cell has changed the state of the notebook. Then, you must respond in one of two ways: either an array of cell indices that can be re-run to restore the state of the notebook before the last cell was executed, OR, code that can be run to revert the last executed cell's mutations.

				If responding with an array of cell indices, your guidelines are as follows:

				1. The array should contain the indices of the cells that need to be re-run.

				2. The array should not contain any duplicate indices.
				
				3. The array should not contain the index of the last executed cell.
				
				4. The array should not contain any indices that are not in the notebook.
				
				5. SKIP cells that do not mutate data (e.g. plots, print statements, etc.).

				If responding with code to run, your response guidelines are as follows:
				1. Start the code cell with a docstring explaining that this code undoes the last executed cell, and if required, briefly explain how/why it does what it does.

				2. The code should be valid Python code that can be executed in the notebook.
				
				3. The code should not contain any print statements or any other output.
				
				4. Comments to explain a line of code are allowed, but no other text is allowed.
				
				5. The code should NOT contain any code that is not necessary to undo the last executed cell.
				
				6. The code SHOULD NOT contain any imports, but you may use imports that are already in the notebook.
				
				7. Be VERY careful with escape characters in the code and make sure you don't break the code.
				
				8. DO NOT WRAP THE CODE IN BACKTICKS - your response will be consumed directly, and WILL NOT BE in a Markdown cell.
				
				9. MAKE SURE THAT YOUR RESPONSE IS NOT JUST A DOCSTRING - PLEASE DON'T FORGET TO WRITE THE CODE!

				---

				Examples:

				1. The user defined a DataFrame with 10,000 rows sourced from a CSV file, and then executed a cell that filtered the DataFrame to only include rows where the value in column A is greater than 10, and squared the filtered values. Since the original data needs to be restored, your response should be an array of cell indices to re-run, starting with the cell where data was re-imported.

				2. The user mutated the column names of a database, replacing "_" with "__a", and ran it twice, resulting in columns with "__a__aa". Your response should be code that replaces "__a" with "_", effectively undoing the last mutation.

				3. The user generated a list comprehension using \`[i for i in range(1000)]\` and then squared the values in the list. The user then RAN THE SAME CELL AGAIN ACCIDENTALLY, squaring the values again. Your response should be an array of cell indices to re-run the list-comprehension and squaring of numbers.

				4. The user binarized a DataFrame column using a threshold, and wants to undo this change. Since the original data MUST be imported again, your response should be an array of cell indices to re-run, starting with importing the data, and re-applying all the transformations.
				`;

						// const response = await openai.chat.completions
						// 	.create({
						// 		model: 'gpt-4.1-nano',
						// 		messages: [
						// 			{
						// 				role: 'system',
						// 				content: prompt,
						// 			},
						// 			{
						// 				role: 'user',
						// 				content: 'Code context:' + JSON.stringify(codeContext),
						// 			},
						// 		],
						// 	})
						// 	.catch((error) => {
						// 		console.error('Error:', error);
						// 		vscode.window.showErrorMessage('Error: ' + error.message);
						// 	});
						// if (response.choices && response.choices.length > 0) {
						// 	const newCell = new vscode.NotebookCellData(
						// 		vscode.NotebookCellKind.Code,
						// 		response.choices[0].message.content.replace('\\\\', '\\'),
						// 		'python'
						// 	);
						// 	const newCellIndex = lastExecutedCell.index + 1;
						// 	const edit = new vscode.WorkspaceEdit();
						// 	edit.set(editor.notebook.uri, [
						// 		vscode.NotebookEdit.insertCells(newCellIndex, [newCell]),
						// 	]);
						// 	context.secrets;
						// 	await vscode.workspace.applyEdit(edit);
						// 	editor.revealRange(
						// 		new vscode.NotebookRange(newCellIndex - 1, newCellIndex),
						// 		vscode.NotebookEditorRevealType.InCenter
						// 	);
						// }
						const response = await openai.beta.chat.completions
							.parse({
								model: 'gpt-4o-mini',
								messages: [
									{
										role: 'system',
										content: prompt,
									},
									{
										role: 'user',
										content: 'Code context:' + JSON.stringify(codeContext),
									},
								],
								response_format: zodResponseFormat(responseSchema, 'response'),
							})
							.catch((error) => {
								console.error('Error:', error);
								vscode.window.showErrorMessage('Error: ' + error.message);
							});
						if (response) {
							if (response.choices[0].message.parsed?.cellsToReRun) {
								console.log(
									'Cells to re-run:',
									response.choices[0].message.parsed.cellsToReRun
								);
								vscode.window.showInformationMessage('Executing cells again...');
								const cellsToReRun =
									response.choices[0].message.parsed.cellsToReRun.sort(
										(a, b) => a - b
									);
								await Promise.all(
									cellsToReRun.map((cellIndex) =>
										vscode.commands.executeCommand('notebook.cell.execute', {
											start: cellIndex,
											end: cellIndex + 1,
										})
									)
								);
								vscode.window.showInformationMessage(
									'The Oopsie has been undone! Cells re-run successfully.'
								);
							}
						}
					}
				} else {
					vscode.window.showInformationMessage(`You're all good - no code executed yet!`);
				}
			}
		);
	});

	const buttonDisposable = vscode.notebooks.registerNotebookCellStatusBarItemProvider(
		'jupyter-notebook',
		{
			provideCellStatusBarItems: (cell) => {
				if (cell.kind !== vscode.NotebookCellKind.Code) {
					return;
				}

				const item = new vscode.NotebookCellStatusBarItem(
					'$(debug-restart) Oops!', // icon + text
					vscode.NotebookCellStatusBarAlignment.Right
				);
				item.tooltip = 'Oops! Undo what you just did.';
				item.command = {
					command: 'oops-button.undo',
					title: 'Undo',
				};
				return [item];
			},
		}
	);

	context.subscriptions.push(disposable, buttonDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {
	// delete the API key from the secrets
	// context.secrets.delete('OOPS_OPENAI_API_KEY');
	// vscode.window.showInformationMessage('The Oops! Button has been deactivated.');
}
