class AppConfig {
  static const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
  static const supabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY');
  static const appHost = String.fromEnvironment(
    'APP_HOST',
    defaultValue: 'saidhere.app',
  );
  static const demoTagToken = String.fromEnvironment('DEMO_TAG_TOKEN');

  static bool get isConfigured =>
      supabaseUrl.trim().isNotEmpty && supabaseAnonKey.trim().isNotEmpty;
}
