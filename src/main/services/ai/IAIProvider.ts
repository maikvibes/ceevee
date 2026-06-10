export interface IAIProvider {
  /**
   * Generates a completion from the AI provider given a prompt.
   * @param prompt The system/user prompt to send to the AI
   * @param apiKey The API key for the specific provider
   * @param model The model to use for the completion
   * @returns The string content of the AI's response
   */
  generateCompletion(prompt: string, apiKey: string, model: string): Promise<string>;
}
