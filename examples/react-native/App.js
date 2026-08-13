import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

// Preview builds boot with a seeded demo session — the struktr mock-auth
// pattern, JS-flavored. No backend involved.
const MOCK_AUTH = true;

export default function App() {
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState(MOCK_AUTH ? 'demo@struktr.app' : '');
  const [password, setPassword] = useState(MOCK_AUTH ? 'preview-only' : '');

  if (!signedIn) {
    return (
      <View style={styles.screen}>
        <Text style={styles.logo}>struktr</Text>
        <Text style={styles.tagline}>React Native example</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          secureTextEntry
        />
        <Pressable style={styles.button} onPress={() => setSignedIn(true)}>
          <Text style={styles.buttonText}>Sign in</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Welcome</Text>
      <Text style={styles.subtitle}>demo@struktr.app · mock session</Text>
      <View style={styles.card}>
        <Text style={styles.cardText}>
          ⚛️ This screen is React Native, captured by the same struktr action
          as the native example
        </Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardText}>
          🤳 Flow: examples/react-native/.maestro/preview/
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FAFAFC',
    paddingHorizontal: 32,
    paddingTop: 96,
  },
  logo: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#5B4CF5',
    textAlign: 'center',
  },
  tagline: {
    fontSize: 16,
    color: '#6B6B80',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 48,
  },
  input: {
    borderBottomWidth: 1,
    borderBottomColor: '#C9C9D6',
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 16,
    color: '#1A1A2E',
  },
  button: {
    backgroundColor: '#5B4CF5',
    borderRadius: 24,
    paddingVertical: 14,
    marginTop: 24,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    textAlign: 'center',
    fontSize: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1A1A2E',
  },
  subtitle: {
    fontSize: 15,
    color: '#6B6B80',
    marginTop: 4,
    marginBottom: 32,
  },
  card: {
    backgroundColor: '#EFEDFD',
    padding: 20,
    marginBottom: 12,
  },
  cardText: {
    fontSize: 16,
    color: '#1A1A2E',
  },
});
