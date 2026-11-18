import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { FormField } from "./form-field";
import { AppText } from "@/components/ui/app-text";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Icon } from "@/components/ui/icon";
import { SCREEN_PADDING } from "@/components/ui/screen";
import { useSite } from "@/context/site";
import { useTheme } from "@/hooks/use-theme";
import { ApiError, errorMessage } from "@/services/api";
import { POPULAR_CURRENCIES } from "../constants/currencies";
import { statusLabels } from "../utils/format";
import {
  EditableStatus,
  emptyTicket,
  EventForm as EventFormValues,
  FormErrors,
  TicketForm,
  validateEvent,
} from "../utils/validate-event";

// Fuseaux proposés en boutons : évite les fautes de frappe dans "Europe/Paris".
// Celui de l'événement (et celui que règle le serveur) s'y ajoute s'il n'y est pas.
const TIMEZONES = ["Europe/Paris", "Europe/London", "America/New_York", "Africa/Abidjan"];

// Le MÊME formulaire sert à la création et à la modification.
// Seuls changent : les valeurs de départ, les statuts proposés, le texte du bouton et ce qu'on fait à l'envoi.
interface EventFormProps {
  initialValues: EventFormValues;
  statusOptions: EditableStatus[]; // un seul choix : rien à choisir, la rubrique « Statut » est masquée
  submitLabel: string;
  onSubmit: (form: EventFormValues) => Promise<void>;
}

export function EventForm({ initialValues, statusOptions, submitLabel, onSubmit }: EventFormProps) {
  const theme = useTheme();
  const site = useSite();
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
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fields).length > 0) {
        // Le serveur peut refuser ce que le formulaire a laissé passer : ses messages ont les mêmes clés ("name", "tickets.0.price"…).
        setErrors(error.fields);
      } else {
        setErrors({ submit: errorMessage(error, "L'enregistrement a échoué. Réessaie.") });
      }
      setSaving(false);
    }
  }

  const hasFieldErrors = Object.keys(errors).some((key) => key !== "submit");
  const timezones = [form.timezone, site?.defaultTimezone, ...TIMEZONES].filter(
    (zone, index, all): zone is string => !!zone && all.indexOf(zone) === index
  );

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled" // un tap sur un bouton marche même clavier ouvert
      automaticallyAdjustKeyboardInsets // iOS : le clavier ne cache pas le champ en cours
    >
      <View style={styles.content}>
        <AppText variant="h2" style={styles.sectionTitle}>
          Informations
        </AppText>

        <FormField
          label="Nom de l'événement"
          value={form.name}
          onChangeText={(value) => updateField("name", value)}
          placeholder="Nom de l'événement"
          error={errors.name}
        />
        <FormField
          label="Lieu"
          value={form.location}
          onChangeText={(value) => updateField("location", value)}
          placeholder="Salle et ville, ou « En ligne »"
          error={errors.location}
        />
        <FormField
          label="Date"
          value={form.date}
          onChangeText={(value) => updateField("date", value)}
          placeholder="AAAA-MM-JJ"
          keyboardType="numbers-and-punctuation"
          error={errors.date}
        />

        {/* Deux champs côte à côte */}
        <View style={styles.row}>
          <FormField
            style={styles.half}
            label="Ouverture des portes (facultatif)"
            value={form.doorsOpenTime}
            onChangeText={(value) => updateField("doorsOpenTime", value)}
            placeholder="HH:MM"
            keyboardType="numbers-and-punctuation"
            error={errors.doorsOpenTime}
          />
          <FormField
            style={styles.half}
            label="Début"
            value={form.startTime}
            onChangeText={(value) => updateField("startTime", value)}
            placeholder="HH:MM"
            keyboardType="numbers-and-punctuation"
            error={errors.startTime}
          />
        </View>

        <AppText variant="smallStrong" style={styles.label}>
          Fuseau horaire
        </AppText>
        <View style={styles.chips}>
          {timezones.map((zone) => (
            <Chip key={zone} label={zone} selected={form.timezone === zone} onPress={() => updateField("timezone", zone)} />
          ))}
        </View>
        {errors.timezone && (
          <AppText variant="caption" color="danger" style={styles.chipsError}>
            {errors.timezone}
          </AppText>
        )}

        <AppText variant="smallStrong" style={styles.label}>
          Devise des prix
        </AppText>
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
          placeholder="Code à 3 lettres"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={3}
          error={errors.currency}
        />

        <FormField
          label="Annulation possible jusqu'au (facultatif)"
          value={form.cancellationDeadline}
          onChangeText={(value) => updateField("cancellationDeadline", value)}
          placeholder="AAAA-MM-JJ"
          keyboardType="numbers-and-punctuation"
          error={errors.cancellationDeadline}
        />

        {/* Un événement en vente ne revient pas en brouillon (des places ont pu être réservées) : alors rien à choisir. */}
        {statusOptions.length > 1 && (
          <>
            <AppText variant="smallStrong" style={styles.label}>
              Statut
            </AppText>
            <View style={styles.chips}>
              {statusOptions.map((status) => (
                <Chip key={status} label={statusLabels[status]} selected={form.status === status} onPress={() => updateField("status", status)} />
              ))}
            </View>
          </>
        )}

        <AppText variant="h2" style={styles.sectionTitle}>
          Types de places
        </AppText>
        {errors.tickets && (
          <Banner tone="danger" style={styles.banner}>
            {errors.tickets}
          </Banner>
        )}

        {form.tickets.map((ticket, index) => {
          const key = `tickets.${index}`;
          return (
            // L'index sert de clé : acceptable ici car les nouvelles lignes n'ont pas encore d'id.
            <Card key={index} style={styles.ticketCard} padding={16} elevated={false}>
              <View style={styles.ticketHeader}>
                <AppText variant="h3">Place {index + 1}</AppText>
                {/* On ne peut pas descendre en dessous de 2 lignes. */}
                {form.tickets.length > 2 && (
                  <Pressable onPress={() => removeTicket(index)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Supprimer la place ${index + 1}`}>
                    <View style={styles.remove}>
                      <Icon name="trash" size={16} color="danger" />
                      <AppText variant="smallStrong" color="danger">
                        Supprimer
                      </AppText>
                    </View>
                  </Pressable>
                )}
              </View>

              <FormField
                label="Nom"
                value={ticket.name}
                onChangeText={(value) => updateTicket(index, "name", value)}
                placeholder="Nom de la catégorie de places"
                error={errors[`${key}.name`]}
              />
              <View style={styles.row}>
                <FormField
                  style={styles.half}
                  label={`Prix (${form.currency})`}
                  value={ticket.price}
                  onChangeText={(value) => updateTicket(index, "price", value)}
                  placeholder="0 = gratuit"
                  keyboardType="decimal-pad"
                  error={errors[`${key}.price`]}
                />
                <FormField
                  style={styles.half}
                  label="Quantité"
                  value={ticket.quantity}
                  onChangeText={(value) => updateTicket(index, "quantity", value)}
                  placeholder="Nombre de places"
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
                  placeholder="Moins que le prix normal"
                  keyboardType="decimal-pad"
                  error={errors[`${key}.earlyPrice`]}
                />
                <FormField
                  style={styles.half}
                  label="Fin du tarif early"
                  value={ticket.earlyPriceDeadline}
                  onChangeText={(value) => updateTicket(index, "earlyPriceDeadline", value)}
                  placeholder="AAAA-MM-JJ"
                  keyboardType="numbers-and-punctuation"
                  error={errors[`${key}.earlyPriceDeadline`]}
                />
              </View>
            </Card>
          );
        })}

        <Button title="Ajouter un type de place" icon="plus" variant="secondary" size="md" onPress={addTicket} style={styles.addButton} />

        {hasFieldErrors && (
          <Banner tone="danger" style={styles.banner}>
            Corrige les champs en rouge avant de continuer.
          </Banner>
        )}
        {errors.submit && (
          <Banner tone="danger" style={styles.banner}>
            {errors.submit}
          </Banner>
        )}

        <Button title={saving ? "Enregistrement…" : submitLabel} onPress={handleSubmit} loading={saving} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: SCREEN_PADDING,
    paddingBottom: 60,
  },

  // Sur grand écran, le formulaire reste centré et étroit plutôt que de s'étirer sur toute la page.
  content: {
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
  },

  sectionTitle: {
    marginTop: 10,
    marginBottom: 16,
  },

  label: {
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

  chipsError: {
    marginTop: -8,
    marginBottom: 16,
  },

  ticketCard: {
    marginBottom: 12,
  },

  ticketHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },

  remove: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  addButton: {
    marginBottom: 20,
  },

  banner: {
    marginBottom: 14,
  },
});
