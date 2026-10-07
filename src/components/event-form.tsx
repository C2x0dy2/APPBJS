import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { FormField } from "./form-field";
import { POPULAR_CURRENCIES } from "../constants/currencies";
import { EvenStatus } from "../types/even";
import { statusLabels } from "../utils/format";
import {
  emptyTicket,
  EventForm as EventFormValues,
  FormErrors,
  TicketForm,
  validateEvent,
} from "../utils/validate-event";

// Fuseaux proposés en boutons : évite les fautes de frappe dans "Europe/Paris".
const TIMEZONES = ["Europe/Paris", "Europe/London", "America/New_York", "Africa/Abidjan"];

// Le MÊME formulaire sert à la création et à la modification.
// Seuls changent : les valeurs de départ, les statuts proposés, le texte du bouton et ce qu'on fait à l'envoi.
interface EventFormProps {
  initialValues: EventFormValues;
  statusOptions: EvenStatus[];
  submitLabel: string;
  onSubmit: (form: EventFormValues) => Promise<void>;
}

export function EventForm({ initialValues, statusOptions, submitLabel, onSubmit }: EventFormProps) {
  // initialValues ne sert qu'au premier affichage ; ensuite c'est "form" qui évolue.
  const [form, setForm] = useState<EventFormValues>(initialValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  // Change UN champ de l'événement en gardant les autres (...form = copie de l'existant).
  function updateField(field: keyof Omit<EventFormValues, "tickets">, value: string) {
    setForm({ ...form, [field]: value });
  }

  // Change UN champ d'UNE ligne de type de place (repérée par son index).
  function updateTicket(index: number, field: keyof TicketForm, value: string) {
    const tickets = form.tickets.map((ticket, i) =>
      i === index ? { ...ticket, [field]: value } : ticket
    );
    setForm({ ...form, tickets });
  }

  function addTicket() {
    setForm({ ...form, tickets: [...form.tickets, emptyTicket] });
  }

  function removeTicket(index: number) {
    setForm({ ...form, tickets: form.tickets.filter((_, i) => i !== index) });
  }

  async function handleSubmit() {
    const foundErrors = validateEvent(form);
    setErrors(foundErrors);
    // Object.keys(...).length > 0 = au moins une erreur : on n'envoie rien.
    if (Object.keys(foundErrors).length > 0) return;

    setSaving(true); // désactive le bouton : empêche d'envoyer 2 fois en double-cliquant
    try {
      await onSubmit(form);
    } catch {
      setErrors({ submit: "L'enregistrement a échoué. Réessaie." });
      setSaving(false);
    }
  }

  const hasFieldErrors = Object.keys(errors).some((key) => key !== "submit");

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled" // un tap sur un bouton marche même clavier ouvert
      automaticallyAdjustKeyboardInsets // iOS : le clavier ne cache pas le champ en cours
    >
      <Text style={styles.sectionTitle}>Informations</Text>

      <FormField
        label="Nom de l'événement"
        value={form.name}
        onChangeText={(value) => updateField("name", value)}
        placeholder="Concert de Tayc"
        error={errors.name}
      />
      <FormField
        label="Lieu"
        value={form.location}
        onChangeText={(value) => updateField("location", value)}
        placeholder="Le Rocher de Palmer, Bordeaux"
        error={errors.location}
      />
      <FormField
        label="Date"
        value={form.date}
        onChangeText={(value) => updateField("date", value)}
        placeholder="2026-11-18"
        keyboardType="numbers-and-punctuation"
        error={errors.date}
      />

      {/* Deux champs côte à côte */}
      <View style={styles.row}>
        <FormField
          style={styles.half}
          label="Ouverture des portes"
          value={form.doorsOpenTime}
          onChangeText={(value) => updateField("doorsOpenTime", value)}
          placeholder="19:00"
          keyboardType="numbers-and-punctuation"
          error={errors.doorsOpenTime}
        />
        <FormField
          style={styles.half}
          label="Début"
          value={form.startTime}
          onChangeText={(value) => updateField("startTime", value)}
          placeholder="20:00"
          keyboardType="numbers-and-punctuation"
          error={errors.startTime}
        />
      </View>

      <Text style={styles.label}>Fuseau horaire</Text>
      <View style={styles.chips}>
        {TIMEZONES.map((zone) => (
          <Chip
            key={zone}
            label={zone}
            selected={form.timezone === zone}
            onPress={() => updateField("timezone", zone)}
          />
        ))}
      </View>

      <Text style={styles.label}>Devise des prix</Text>
      <View style={styles.chips}>
        {POPULAR_CURRENCIES.map(({ code, label }) => (
          <Chip
            key={code}
            label={`${code} · ${label}`}
            selected={form.currency === code}
            onPress={() => updateField("currency", code)}
          />
        ))}
      </View>
      {/* Toute autre devise : il suffit de taper son code ISO (JPY, BRL, ZAR...). */}
      <FormField
        label="Code devise"
        value={form.currency}
        onChangeText={(value) => updateField("currency", value.toUpperCase().trim())}
        placeholder="XOF"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={3}
        error={errors.currency}
      />

      <FormField
        label="Annulation possible jusqu'au"
        value={form.cancellationDeadline}
        onChangeText={(value) => updateField("cancellationDeadline", value)}
        placeholder="2026-11-17"
        keyboardType="numbers-and-punctuation"
        error={errors.cancellationDeadline}
      />

      <Text style={styles.label}>Statut</Text>
      <View style={styles.chips}>
        {statusOptions.map((status) => (
          <Chip
            key={status}
            label={statusLabels[status]}
            selected={form.status === status}
            onPress={() => updateField("status", status)}
          />
        ))}
      </View>

      <Text style={styles.sectionTitle}>Types de places</Text>
      {errors.tickets && <Text style={styles.error}>{errors.tickets}</Text>}

      {form.tickets.map((ticket, index) => {
        const key = `tickets.${index}`;
        return (
          // L'index sert de clé : acceptable ici car les nouvelles lignes n'ont pas encore d'id.
          <View key={index} style={styles.ticketCard}>
            <View style={styles.ticketHeader}>
              <Text style={styles.ticketTitle}>Place {index + 1}</Text>
              {/* On ne peut pas descendre en dessous de 2 lignes. */}
              {form.tickets.length > 2 && (
                <Pressable onPress={() => removeTicket(index)} hitSlop={10}>
                  <Text style={styles.remove}>Supprimer</Text>
                </Pressable>
              )}
            </View>

            <FormField
              label="Nom"
              value={ticket.name}
              onChangeText={(value) => updateTicket(index, "name", value)}
              placeholder="Fosse, Balcon, VIP…"
              error={errors[`${key}.name`]}
            />
            <View style={styles.row}>
              <FormField
                style={styles.half}
                label={`Prix (${form.currency})`}
                value={ticket.price}
                onChangeText={(value) => updateTicket(index, "price", value)}
                placeholder="20"
                keyboardType="decimal-pad"
                error={errors[`${key}.price`]}
              />
              <FormField
                style={styles.half}
                label="Quantité"
                value={ticket.quantity}
                onChangeText={(value) => updateTicket(index, "quantity", value)}
                placeholder="200"
                keyboardType="number-pad"
                error={errors[`${key}.quantity`]}
              />
            </View>
            <View style={styles.row}>
              <FormField
                style={styles.half}
                label={`Prix early (${form.currency}, facultatif)`}
                value={ticket.earlyPrice}
                onChangeText={(value) => updateTicket(index, "earlyPrice", value)}
                placeholder="15"
                keyboardType="decimal-pad"
                error={errors[`${key}.earlyPrice`]}
              />
              <FormField
                style={styles.half}
                label="Fin du tarif early"
                value={ticket.earlyPriceDeadline}
                onChangeText={(value) => updateTicket(index, "earlyPriceDeadline", value)}
                placeholder="2026-10-31"
                keyboardType="numbers-and-punctuation"
                error={errors[`${key}.earlyPriceDeadline`]}
              />
            </View>
          </View>
        );
      })}

      <Pressable style={styles.addButton} onPress={addTicket}>
        <Text style={styles.addButtonText}>+ Ajouter un type de place</Text>
      </Pressable>

      {hasFieldErrors && <Text style={styles.error}>Corrige les champs en rouge avant de continuer.</Text>}
      {errors.submit && <Text style={styles.error}>{errors.submit}</Text>}

      <Pressable
        style={[styles.button, saving && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={saving}
      >
        <Text style={styles.buttonText}>{saving ? "Enregistrement…" : submitLabel}</Text>
      </Pressable>
    </ScrollView>
  );
}

// Petit bouton arrondi sélectionnable (fuseau horaire, statut).
function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, selected && styles.chipSelected]} onPress={onPress}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },

  content: {
    padding: 20,
    paddingBottom: 60,
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginTop: 10,
    marginBottom: 14,
  },

  label: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },

  row: {
    flexDirection: "row",
    gap: 12,
  },

  half: {
    flex: 1,
  },

  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },

  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#ddd",
  },

  chipSelected: {
    backgroundColor: "#000",
    borderColor: "#000",
  },

  chipText: {
    fontSize: 14,
  },

  chipTextSelected: {
    color: "#fff",
    fontWeight: "bold",
  },

  ticketCard: {
    padding: 16,
    borderRadius: 15,
    backgroundColor: "#f5f5f5",
    marginBottom: 12,
  },

  ticketHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },

  ticketTitle: {
    fontSize: 16,
    fontWeight: "bold",
  },

  remove: {
    color: "#c62828",
    fontWeight: "600",
  },

  addButton: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#999",
    marginBottom: 20,
  },

  addButtonText: {
    textAlign: "center",
    fontSize: 15,
    fontWeight: "600",
  },

  error: {
    color: "#c62828",
    fontSize: 14,
    marginBottom: 12,
  },

  button: {
    padding: 15,
    borderRadius: 10,
    backgroundColor: "#000",
  },

  buttonDisabled: {
    opacity: 0.5,
  },

  buttonText: {
    color: "#fff",
    textAlign: "center",
    fontSize: 16,
    fontWeight: "bold",
  },
});
