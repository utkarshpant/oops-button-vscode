# oops-button README

When you're working on Jupyter Notebooks, the kernel executing your code doesn't really care (or know) about the code you have in your notebook. It just executes the code you send it, and returns the result. Along the way, it builds some _state_ in memory, which is used to keep track of variables, functions, DataFrames, and other objects you create. Sometimes, you add code cells to quickly experiment with something, and then you forget to delete them. Or you run a cell that you didn't mean to run, and now your kernel is in a state you don't want it to be in. _Oops!_

When you find yourself in this situation, hit `Ctrl + Alt + ;`, or click the "Oops!" button below the code cell. Using everything you've written and run so far, the extension figures out how to restore your kernel to the way it was before the _Oopsie._ This new code is added to a cell just below the one you ran last, and you can inspect the code before you run it. That's all it does - but if you constantly run into Oopsies like I do, this is a big quality of life improvement.

## Features

* **Restore Kernel State**: Hit `Ctrl + Alt + ;` to restore the kernel state to the way it was before the last code cell you ran. The code is added to a new cell below the one you just ran, so you can inspect it before running it.

## Requirements

When you run the extension for the first time, it will ask you for an OpenAI API key. This is a one-time operation and uses the VSCode Secrets API to store the key securely.

## Known Issues

1. Generated code is not guaranteed to work, and _can_ be flaky at times.

2. No tests at this time.

## Release Notes

### 0.0.1

The initial Oops! Button release.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

---

**Enjoy!**
