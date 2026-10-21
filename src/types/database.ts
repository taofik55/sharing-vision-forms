export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      answer_summary: {
        Row: {
          cnt: number;
          day: string;
          device: string;
          form_id: string;
          form_version_id: string;
          kind: unknown;
          locale: string;
          question_key: string;
          total: number | null;
          value: string;
        };
        ComputedFields: never;
        Insert: {
          cnt: number;
          day: string;
          device: string;
          form_id: string;
          form_version_id: string;
          kind: unknown;
          locale: string;
          question_key: string;
          total?: number | null;
          value: string;
        };
        Update: {
          cnt?: number;
          day?: string;
          device?: string;
          form_id?: string;
          form_version_id?: string;
          kind?: unknown;
          locale?: string;
          question_key?: string;
          total?: number | null;
          value?: string;
        };
        Relationships: [
          {
            foreignKeyName: "answer_summary_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
        ];
      };
      dashboard_shares: {
        Row: {
          created_at: string;
          created_by: string | null;
          expires_at: string | null;
          form_id: string;
          id: string;
          include_text_answers: boolean;
          is_active: boolean;
          token: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          expires_at?: string | null;
          form_id: string;
          id?: string;
          include_text_answers?: boolean;
          is_active?: boolean;
          token?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          expires_at?: string | null;
          form_id?: string;
          id?: string;
          include_text_answers?: boolean;
          is_active?: boolean;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "dashboard_shares_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dashboard_shares_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
        ];
      };
      dashboards: {
        Row: {
          config: NonNullable<Json>;
          form_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          config?: NonNullable<Json>;
          form_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          config?: NonNullable<Json>;
          form_id?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "dashboards_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: true;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dashboards_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      form_members: {
        Row: {
          created_at: string;
          form_id: string;
          role: Database["public"]["Enums"]["member_role"];
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          form_id: string;
          role?: Database["public"]["Enums"]["member_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          form_id?: string;
          role?: Database["public"]["Enums"]["member_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "form_members_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "form_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      form_versions: {
        Row: {
          definition: NonNullable<Json>;
          form_id: string;
          id: string;
          published_at: string;
          published_by: string | null;
          version_number: number;
        };
        ComputedFields: never;
        Insert: {
          definition: NonNullable<Json>;
          form_id: string;
          id?: string;
          published_at?: string;
          published_by?: string | null;
          version_number: number;
        };
        Update: {
          definition?: NonNullable<Json>;
          form_id?: string;
          id?: string;
          published_at?: string;
          published_by?: string | null;
          version_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "form_versions_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "form_versions_published_by_fkey";
            columns: ["published_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      forms: {
        Row: {
          capi_settings: NonNullable<Json>;
          closed_message: string | null;
          created_at: string;
          current_version_id: string | null;
          deadline_at: string | null;
          description: string | null;
          draft_definition: NonNullable<Json>;
          id: string;
          identifier_mode: Database["public"]["Enums"]["identifier_mode"];
          is_demo: boolean;
          owner_id: string;
          slug: string;
          status: Database["public"]["Enums"]["form_status"];
          thank_you_message: string | null;
          title: string;
          updated_at: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          capi_settings?: NonNullable<Json>;
          closed_message?: string | null;
          created_at?: string;
          current_version_id?: string | null;
          deadline_at?: string | null;
          description?: string | null;
          draft_definition?: NonNullable<Json>;
          id?: string;
          identifier_mode?: Database["public"]["Enums"]["identifier_mode"];
          is_demo?: boolean;
          owner_id: string;
          slug: string;
          status?: Database["public"]["Enums"]["form_status"];
          thank_you_message?: string | null;
          title: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          capi_settings?: NonNullable<Json>;
          closed_message?: string | null;
          created_at?: string;
          current_version_id?: string | null;
          deadline_at?: string | null;
          description?: string | null;
          draft_definition?: NonNullable<Json>;
          id?: string;
          identifier_mode?: Database["public"]["Enums"]["identifier_mode"];
          is_demo?: boolean;
          owner_id?: string;
          slug?: string;
          status?: Database["public"]["Enums"]["form_status"];
          thank_you_message?: string | null;
          title?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "forms_current_version_fk";
            columns: ["current_version_id", "id"];
            isOneToOne: false;
            referencedRelation: "form_versions";
            referencedColumns: ["id", "form_id"];
          },
          {
            foreignKeyName: "forms_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "forms_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      interview_sequences: {
        Row: {
          form_id: string;
          last_seq: number;
          prefix: string;
        };
        ComputedFields: never;
        Insert: {
          form_id: string;
          last_seq?: number;
          prefix: string;
        };
        Update: {
          form_id?: string;
          last_seq?: number;
          prefix?: string;
        };
        Relationships: [
          {
            foreignKeyName: "interview_sequences_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          is_active: boolean;
          locale: string;
          role: Database["public"]["Enums"]["app_role"];
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          is_active?: boolean;
          locale?: string;
          role?: Database["public"]["Enums"]["app_role"];
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          is_active?: boolean;
          locale?: string;
          role?: Database["public"]["Enums"]["app_role"];
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      rate_limits: {
        Row: {
          bucket: string;
          hits: number;
          window_start: string;
        };
        ComputedFields: never;
        Insert: {
          bucket: string;
          hits?: number;
          window_start: string;
        };
        Update: {
          bucket?: string;
          hits?: number;
          window_start?: string;
        };
        Relationships: [];
      };
      response_answers: {
        Row: {
          form_id: string;
          id: number;
          question_key: string;
          question_type: string;
          response_id: string;
          value_date: string | null;
          value_json: Json | null;
          value_number: number | null;
          value_options: string[] | null;
          value_text: string | null;
        };
        ComputedFields: never;
        Insert: {
          form_id: string;
          id?: never;
          question_key: string;
          question_type: string;
          response_id: string;
          value_date?: string | null;
          value_json?: Json | null;
          value_number?: number | null;
          value_options?: string[] | null;
          value_text?: string | null;
        };
        Update: {
          form_id?: string;
          id?: never;
          question_key?: string;
          question_type?: string;
          response_id?: string;
          value_date?: string | null;
          value_json?: Json | null;
          value_number?: number | null;
          value_options?: string[] | null;
          value_text?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "response_answers_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "response_answers_response_id_fkey";
            columns: ["response_id"];
            isOneToOne: false;
            referencedRelation: "responses";
            referencedColumns: ["id"];
          },
        ];
      };
      response_archive: {
        Row: {
          answers: NonNullable<Json>;
          archived_at: string;
          archived_by: string | null;
          form_id: string;
          id: string;
          reason: string | null;
          response: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          answers: NonNullable<Json>;
          archived_at?: string;
          archived_by?: string | null;
          form_id: string;
          id: string;
          reason?: string | null;
          response: NonNullable<Json>;
        };
        Update: {
          answers?: NonNullable<Json>;
          archived_at?: string;
          archived_by?: string | null;
          form_id?: string;
          id?: string;
          reason?: string | null;
          response?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: "response_archive_archived_by_fkey";
            columns: ["archived_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "response_archive_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
        ];
      };
      response_drafts: {
        Row: {
          data: NonNullable<Json>;
          draft_token: string;
          expires_at: string;
          form_id: string;
          id: string;
          updated_at: string;
          version_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          data?: NonNullable<Json>;
          draft_token?: string;
          expires_at?: string;
          form_id: string;
          id?: string;
          updated_at?: string;
          version_id?: string | null;
        };
        Update: {
          data?: NonNullable<Json>;
          draft_token?: string;
          expires_at?: string;
          form_id?: string;
          id?: string;
          updated_at?: string;
          version_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "response_drafts_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "response_drafts_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "form_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      response_photos: {
        Row: {
          created_at: string;
          data: string;
          form_id: string;
          id: string;
          mime: string;
          response_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          data: string;
          form_id: string;
          id: string;
          mime: string;
          response_id?: string | null;
        };
        Update: {
          created_at?: string;
          data?: string;
          form_id?: string;
          id?: string;
          mime?: string;
          response_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "response_photos_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "response_photos_response_id_fkey";
            columns: ["response_id"];
            isOneToOne: false;
            referencedRelation: "responses";
            referencedColumns: ["id"];
          },
        ];
      };
      response_screenouts: {
        Row: {
          answers: NonNullable<Json>;
          device: string | null;
          duration_seconds: number | null;
          form_id: string;
          form_version_id: string;
          id: string;
          kind: string;
          locale: string | null;
          notes: NonNullable<Json>;
          question_code: string | null;
          question_key: string | null;
          quota_cell: string | null;
          reason: string | null;
          submission_token: string;
          submitted_at: string;
          surveyor_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          answers?: NonNullable<Json>;
          device?: string | null;
          duration_seconds?: number | null;
          form_id: string;
          form_version_id: string;
          id?: string;
          kind: string;
          locale?: string | null;
          notes?: NonNullable<Json>;
          question_code?: string | null;
          question_key?: string | null;
          quota_cell?: string | null;
          reason?: string | null;
          submission_token: string;
          submitted_at?: string;
          surveyor_id?: string | null;
        };
        Update: {
          answers?: NonNullable<Json>;
          device?: string | null;
          duration_seconds?: number | null;
          form_id?: string;
          form_version_id?: string;
          id?: string;
          kind?: string;
          locale?: string | null;
          notes?: NonNullable<Json>;
          question_code?: string | null;
          question_key?: string | null;
          quota_cell?: string | null;
          reason?: string | null;
          submission_token?: string;
          submitted_at?: string;
          surveyor_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "response_screenouts_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "response_screenouts_surveyor_id_fkey";
            columns: ["surveyor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "response_screenouts_version_fk";
            columns: ["form_version_id", "form_id"];
            isOneToOne: false;
            referencedRelation: "form_versions";
            referencedColumns: ["id", "form_id"];
          },
        ];
      };
      response_summary: {
        Row: {
          cnt: number;
          device: string;
          dur_n: number;
          dur_sum: number;
          first_at: string;
          form_id: string;
          form_version_id: string;
          hour: string;
          last_at: string;
          locale: string;
        };
        ComputedFields: never;
        Insert: {
          cnt: number;
          device: string;
          dur_n: number;
          dur_sum: number;
          first_at: string;
          form_id: string;
          form_version_id: string;
          hour: string;
          last_at: string;
          locale: string;
        };
        Update: {
          cnt?: number;
          device?: string;
          dur_n?: number;
          dur_sum?: number;
          first_at?: string;
          form_id?: string;
          form_version_id?: string;
          hour?: string;
          last_at?: string;
          locale?: string;
        };
        Relationships: [
          {
            foreignKeyName: "response_summary_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
        ];
      };
      responses: {
        Row: {
          backcheck_at: string | null;
          device: string | null;
          duration_seconds: number | null;
          form_id: string;
          form_version_id: string;
          id: string;
          identifier_email: string | null;
          identifier_key: string | null;
          identifier_phone: string | null;
          is_demo: boolean;
          is_reserve: boolean;
          locale: string | null;
          notes: NonNullable<Json>;
          qc_flags: string[];
          qc_note: string | null;
          qc_reviewed_at: string | null;
          qc_reviewed_by: string | null;
          qc_status: string;
          quota_cell: string | null;
          respondent_code: string | null;
          submission_token: string | null;
          submitted_at: string;
          surveyor_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          backcheck_at?: string | null;
          device?: string | null;
          duration_seconds?: number | null;
          form_id: string;
          form_version_id: string;
          id?: string;
          identifier_email?: string | null;
          identifier_key?: string | null;
          identifier_phone?: string | null;
          is_demo?: boolean;
          is_reserve?: boolean;
          locale?: string | null;
          notes?: NonNullable<Json>;
          qc_flags?: string[];
          qc_note?: string | null;
          qc_reviewed_at?: string | null;
          qc_reviewed_by?: string | null;
          qc_status?: string;
          quota_cell?: string | null;
          respondent_code?: string | null;
          submission_token?: string | null;
          submitted_at?: string;
          surveyor_id?: string | null;
        };
        Update: {
          backcheck_at?: string | null;
          device?: string | null;
          duration_seconds?: number | null;
          form_id?: string;
          form_version_id?: string;
          id?: string;
          identifier_email?: string | null;
          identifier_key?: string | null;
          identifier_phone?: string | null;
          is_demo?: boolean;
          is_reserve?: boolean;
          locale?: string | null;
          notes?: NonNullable<Json>;
          qc_flags?: string[];
          qc_note?: string | null;
          qc_reviewed_at?: string | null;
          qc_reviewed_by?: string | null;
          qc_status?: string;
          quota_cell?: string | null;
          respondent_code?: string | null;
          submission_token?: string | null;
          submitted_at?: string;
          surveyor_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "responses_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "responses_form_version_fk";
            columns: ["form_version_id", "form_id"];
            isOneToOne: false;
            referencedRelation: "form_versions";
            referencedColumns: ["id", "form_id"];
          },
          {
            foreignKeyName: "responses_qc_reviewed_by_fkey";
            columns: ["qc_reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "responses_surveyor_id_fkey";
            columns: ["surveyor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          created_at: string;
          id: string;
          name: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      _analysis_questions: {
        Args: { p_def: Json; p_q: Json };
        Returns: Json[];
      };
      _answer_summary_sql: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      _answer_text: {
        Args: { p_full: boolean; p_text: string; p_type: string };
        Returns: string;
      };
      _assert_can_edit: { Args: { p_form_id: string }; Returns: undefined };
      _assert_can_view: { Args: { p_form_id: string }; Returns: undefined };
      _bundle_questions: {
        Args: { p_filters: Json; p_form_id: string; p_only_key?: string };
        Returns: Json;
      };
      _can_see_identifiers: { Args: { p_form_id: string }; Returns: boolean };
      _chart_field_type: {
        Args: { p_field: Json; p_form_id: string };
        Returns: string;
      };
      _cross_stats_f: {
        Args: { p_filters: Json; p_form_id: string; p_qa: Json; p_qb: Json };
        Returns: Json;
      };
      _dashboard_overview: {
        Args: { p_filters: Json; p_form_id: string };
        Returns: Json;
      };
      _dashboard_overview_raw: {
        Args: { p_filters: Json; p_form_id: string };
        Returns: Json;
      };
      _dashboard_responses: {
        Args: { p_filters: Json; p_form_id: string; p_ignore_dates?: boolean };
        Returns: {
          device: string;
          duration_seconds: number;
          form_version_id: string;
          id: string;
          locale: string;
          submitted_at: string;
        }[];
      };
      _demo_latent: {
        Args: { p_id: string };
        Returns: {
          response_id: string;
          s: number;
          seg: number;
        }[];
      };
      _demo_normal: { Args: Record<PropertyKey, never>; Returns: number };
      _form_question_index: {
        Args: { p_form_id: string };
        Returns: {
          in_current: boolean;
          key: string;
          meta: Json;
          ord: number;
          version_ids: string[];
          version_numbers: number[];
        }[];
      };
      _lock_form_summary: { Args: { p_form_id: string }; Returns: undefined };
      _question_meta: {
        Args: { p_form_id: string; p_key: string };
        Returns: Json;
      };
      _rebuild_summary_slice: {
        Args: { p_form_id: string; p_from: string; p_to: string };
        Returns: undefined;
      };
      _stop_words: { Args: Record<PropertyKey, never>; Returns: string[] };
      _summary_filters_ok: {
        Args: { p_day: boolean; p_filters: Json };
        Returns: boolean;
      };
      add_form_member: {
        Args: {
          p_email: string;
          p_form_id: string;
          p_role: Database["public"]["Enums"]["member_role"];
        };
        Returns: {
          app_role: Database["public"]["Enums"]["app_role"];
          email: string;
          full_name: string;
          role: Database["public"]["Enums"]["member_role"];
          user_id: string;
        }[];
      };
      analyze_response_tables: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      can_edit_form: { Args: { p_form_id: string }; Returns: boolean };
      can_interview: { Args: { p_form_id: string }; Returns: boolean };
      can_view_form: { Args: { p_form_id: string }; Returns: boolean };
      check_rate_limit: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds: number };
        Returns: boolean;
      };
      cross_stats: {
        Args: {
          p_filters?: Json;
          p_form_id: string;
          p_question_a: string;
          p_question_b: string;
        };
        Returns: Json;
      };
      cross_suggestions: {
        Args: { p_filters?: Json; p_form_id: string };
        Returns: Json;
      };
      current_app_role: {
        Args: Record<PropertyKey, never>;
        Returns: Database["public"]["Enums"]["app_role"];
      };
      current_workspace_id: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      dashboard_bundle: {
        Args: { p_filters?: Json; p_form_id: string };
        Returns: Json;
      };
      dashboard_overview: {
        Args: { p_filters?: Json; p_form_id: string };
        Returns: Json;
      };
      dashboard_query: {
        Args: { p_filters?: Json; p_form_id: string; p_spec: Json };
        Returns: Json;
      };
      delete_demo_responses: {
        Args: { p_form_id: string; p_limit?: number };
        Returns: number;
      };
      delete_response_draft: {
        Args: { p_draft_token: string; p_form_id: string };
        Returns: undefined;
      };
      export_responses: {
        Args: {
          p_after_at?: string;
          p_after_id?: string;
          p_filters?: Json;
          p_form_id: string;
          p_limit?: number;
        };
        Returns: {
          answers: Json;
          duration_seconds: number;
          id: string;
          identifier_email: string;
          identifier_phone: string;
          notes: Json;
          qc_status: string;
          quota_cell: string;
          respondent_code: string;
          submitted_at: string;
          surveyor: string;
          version_number: number;
        }[];
      };
      generate_demo_responses: {
        Args: {
          p_days?: number;
          p_form_id: string;
          p_live?: boolean;
          p_n: number;
        };
        Returns: number;
      };
      get_response: { Args: { p_response_id: string }; Returns: Json };
      get_response_photo: {
        Args: { p_photo_id: string };
        Returns: {
          data: string;
          mime: string;
        }[];
      };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_form_owner: { Args: { p_form_id: string }; Returns: boolean };
      is_slug_available: {
        Args: { p_form_id?: string; p_slug: string };
        Returns: boolean;
      };
      list_form_members: {
        Args: { p_form_id: string };
        Returns: {
          app_role: Database["public"]["Enums"]["app_role"];
          email: string;
          full_name: string;
          role: Database["public"]["Enums"]["member_role"];
          user_id: string;
        }[];
      };
      list_form_owners: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string;
          name: string;
        }[];
      };
      list_forms: {
        Args: {
          p_include_demo?: boolean;
          p_limit?: number;
          p_offset?: number;
          p_owner?: string;
          p_scope?: string;
          p_search?: string;
          p_sort?: string;
          p_status?: Database["public"]["Enums"]["form_status"];
        };
        Returns: {
          access: string;
          can_edit: boolean;
          created_at: string;
          current_version_number: number;
          has_unpublished_changes: boolean;
          id: string;
          is_demo: boolean;
          last_response_at: string;
          owner_id: string;
          owner_name: string;
          response_count: number;
          slug: string;
          status: Database["public"]["Enums"]["form_status"];
          title: string;
          total_count: number;
          updated_at: string;
        }[];
      };
      list_interview_forms: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string;
          my_screenouts: number;
          my_today: number;
          my_total: number;
          status: Database["public"]["Enums"]["form_status"];
          title: string;
          total: number;
        }[];
      };
      list_responses: {
        Args: {
          p_cursor?: Json;
          p_filters?: Json;
          p_form_id: string;
          p_limit?: number;
          p_search?: string;
          p_sort?: string;
        };
        Returns: Json;
      };
      list_screenouts: {
        Args: { p_form_id: string; p_limit?: number; p_offset?: number };
        Returns: Json;
      };
      mask_email: { Args: { p_email: string }; Returns: string };
      mask_phone: { Args: { p_phone: string }; Returns: string };
      publish_form: {
        Args: { p_expected_updated_at?: string; p_form_id: string };
        Returns: {
          updated_at: string;
          version_id: string;
          version_number: number;
        }[];
      };
      qc_list: {
        Args: {
          p_form_id: string;
          p_limit?: number;
          p_offset?: number;
          p_surveyor_id?: string;
          p_view?: string;
        };
        Returns: Json;
      };
      qc_overview: { Args: { p_form_id: string }; Returns: Json };
      qc_reject: {
        Args: { p_reason?: string; p_response_id: string };
        Returns: undefined;
      };
      qc_restore: { Args: { p_archive_id: string }; Returns: undefined };
      qc_select_backcheck: {
        Args: { p_form_id: string; p_percent?: number };
        Returns: number;
      };
      qc_set_status: {
        Args: { p_note?: string; p_response_id: string; p_status: string };
        Returns: undefined;
      };
      question_stats: {
        Args: { p_filters?: Json; p_form_id: string; p_question_key: string };
        Returns: Json;
      };
      question_text_answers: {
        Args: {
          p_before_at?: string;
          p_before_id?: string;
          p_filters?: Json;
          p_form_id: string;
          p_limit?: number;
          p_question_key: string;
        };
        Returns: {
          response_id: string;
          submitted_at: string;
          value: string;
        }[];
      };
      quota_count: {
        Args: { p_cell: string; p_form_id: string };
        Returns: number;
      };
      rebuild_dashboard_summary: {
        Args: { p_form_id?: string };
        Returns: number;
      };
      record_screenout: {
        Args: {
          p_answers?: Json;
          p_device?: string;
          p_duration_seconds?: number;
          p_form_id: string;
          p_kind: string;
          p_locale?: string;
          p_notes?: Json;
          p_question_code?: string;
          p_question_key?: string;
          p_quota_cell?: string;
          p_reason?: string;
          p_submission_token: string;
          p_submitted_at?: string;
          p_surveyor_id?: string;
          p_version_id: string;
        };
        Returns: string;
      };
      save_response_draft: {
        Args: {
          p_data: Json;
          p_draft_token: string;
          p_form_id: string;
          p_version_id: string;
        };
        Returns: boolean;
      };
      submit_response: {
        Args: {
          p_answers: Json;
          p_device?: string;
          p_draft_token?: string;
          p_duration_seconds?: number;
          p_form_id: string;
          p_id_digits?: number;
          p_identifier_email?: string;
          p_identifier_key?: string;
          p_identifier_phone?: string;
          p_locale?: string;
          p_notes?: Json;
          p_photos?: Json;
          p_qc_flags?: string[];
          p_quota_cell?: string;
          p_quota_reserve?: number;
          p_quota_target?: number;
          p_submission_token: string;
          p_submitted_at?: string;
          p_surveyor_id?: string;
          p_version_id: string;
        };
        Returns: {
          replayed: boolean;
          respondent_code: string;
          response_id: string;
        }[];
      };
    };
    Enums: {
      app_role: "admin" | "editor" | "viewer" | "surveyor";
      form_status: "draft" | "published" | "closed" | "archived";
      identifier_mode: "none" | "email" | "phone" | "email_or_phone";
      member_role: "viewer" | "editor" | "surveyor";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "editor", "viewer", "surveyor"],
      form_status: ["draft", "published", "closed", "archived"],
      identifier_mode: ["none", "email", "phone", "email_or_phone"],
      member_role: ["viewer", "editor", "surveyor"],
    },
  },
} as const;
