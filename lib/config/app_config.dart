class AppConfig {
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://saidhere-api-9ab3.onrender.com',
  );
  static const appHost = String.fromEnvironment(
    'APP_HOST',
    defaultValue: 'saidhere.app',
  );
  static const demoTagToken = String.fromEnvironment('DEMO_TAG_TOKEN');

  static bool get isConfigured => apiBaseUrl.trim().isNotEmpty;
}
