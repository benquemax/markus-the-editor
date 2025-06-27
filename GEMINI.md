# Gemini CLI Agent Notes

## Long-Running Processes

When running commands like `pnpm dev` or any other command that starts a continuous development server or background process, the `run_shell_command` tool will hang as it waits for the process to complete. 

**Action for the agent:** Do not attempt to run such commands directly. Instead, inform the user that these commands will run indefinitely and ask them to execute them manually if they wish to start a development server or similar long-running process.

## Development Workflow and Verification

To ensure code quality and prevent regressions, the following development cycle must be adhered to:

1.  **Write Tests:** Before implementing a feature (if applicable), write unit or integration tests that confirm the desired functionality. These tests should initially fail.
2.  **Implement Feature:** Implement the feature or fix the bug.
3.  **Run Tests:** Execute the newly written tests to ensure they pass. If they fail, iterate on the implementation until all tests pass.
4.  **Integrate Tests:** Integrate the new tests into the project's automated build process (e.g., by adding them to `package.json` scripts or build configurations) so they run automatically on every build.
5.  **Run Lint & Build:** Before asking the user to run the development server or test the feature, always run the project's linting and build commands (e.g., `pnpm lint`, `pnpm build`, `tsc`). It is unproductive to ask the user to test a feature if the code does not pass linting or fails to build.
6.  **User Verification:** Only after all tests pass, and linting and building are successful, should the user be asked to verify the feature (e.g., by running the development server).